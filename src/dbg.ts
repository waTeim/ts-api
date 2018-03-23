import * as ts from "typescript";
import * as fs from "fs";
import * as glob from "glob";
import * as doctrine from "doctrine";

const tsany = ts as any;

interface TypedId {
  id: string,
  type: Object
};

interface DecoratedItem {
  className: string,
  type: string,
  decorates: string,
  decoratorArgs: any[],
  methodParameters: TypedId[]
};

let symtab = {};
let checker;

function tokenObjectToJSON(o:any,jsDoc:any) {
  let res = null;
  let unknown = false;

  switch(o.kind) {
    case ts.SyntaxKind.StringKeyword:
    {
      res = { type:"string" };
    }
    break;
    case ts.SyntaxKind.NumberKeyword:
    {
      res = { type:"number" };
    }
    break;
    case ts.SyntaxKind.BooleanKeyword: res =  { type:"boolean" }; break;
    case ts.SyntaxKind.AnyKeyword: res = { type:"object" }; break;
    case ts.SyntaxKind.NullKeyword: res = { type:"null" }; break;
    case ts.SyntaxKind.UndefinedKeyword: break;
    case ts.SyntaxKind.SymbolKeyword: break;
    case ts.SyntaxKind.FunctionType: break;
    default: unknown = true; break;
  }
  if(unknown) throw(`unknown type  (${o.kind}) in parameterlist`);
  else return res;
}

function maptypeDescName(name: string): Object {
  if(name == "Object") return { type:"object" };
  if(name == "String") return { type:"string" };
  if(name == "Number") return { type:"number" };
  if(name == "Boolean") return { type:"boolean" };
  if(name == "Function") return null;
  return { "$ref":`#/definitions/${name}` };
}

function unionToJSON(typeDesc:any,jsDoc:any):Object {
   let unionDesc = <ts.UnionTypeNode>typeDesc;
   let res = { oneOf:[] };

   for(let i = 0;i < unionDesc.types.length;i++) {
     let unionElement = typeToJSON(unionDesc.types[i],null);

     if(unionElement != null) res.oneOf.push(unionElement);
   }
   return res;
}

function literalToJSON(typeDesc:any,jsDoc:any):Object {
  let type = checker.getTypeFromTypeNode(typeDesc);

  if(type.value != null) {
    return { type:(typeof type.value), oneOf:[{ format:type.value }] };
  }
  
  let literal = checker.typeToString(type);

  throw("unknown literal type (" + literal + ")");
}

function applyValueTag(schemaObject: any,title: string,value: any): void {
  if(schemaObject.type != null && schemaObject.type != "null") schemaObject[title] = value;
    else if(schemaObject.oneOf != null) {
    for(let i = 0;i < schemaObject.oneOf.length;i++) {
      if(schemaObject.oneOf[i].type != null && schemaObject.oneOf[i].type != "null") schemaObject.oneOf[i][title] = value;
    }
  }
}

function applyTypenameTag(schemaObject: any,name: string): void {
  if(schemaObject.type != null && schemaObject.type != "null") schemaObject.type = name;
  else if(schemaObject.oneOf != null) {
    for(let i = 0;i < schemaObject.oneOf.length;i++) {
      if(schemaObject.oneOf[i].type != null && schemaObject.oneOf[i].type != "null") schemaObject.oneOf[i].type = name;
    }
  }
}

function applyTag(schemaObject: any,tag: any): void {
   if(tag == null) return;
   if(tag.title == "minimum" || tag.title == "maximum") applyValueTag(schemaObject,tag.title,parseInt(tag.description));
   else if(tag.title == "type") {
     if(tag.type.type == "NameExpression") applyTypenameTag(schemaObject,tag.type.name);
   }
}

function typeToJSON(typeDesc:any,jsDoc:any):Object {
  let res;

  if(typeDesc.constructor.name == 'NodeObject') {
    let unknown = false;

    switch(typeDesc.kind) {
      case ts.SyntaxKind.ArrayType: res =  { type:"array", items:typeToJSON(typeDesc.elementType,jsDoc) }; break;
      case ts.SyntaxKind.TypeReference: res =  maptypeDescName(typeDesc.typeName.text); break;
      case ts.SyntaxKind.FunctionType: break;
      case ts.SyntaxKind.TypeQuery: res = null; break;
      case ts.SyntaxKind.UnionType: res = unionToJSON(typeDesc,jsDoc); break;
      case ts.SyntaxKind.LiteralType: res = literalToJSON(typeDesc,jsDoc); break;
      case ts.SyntaxKind.ParenthesizedType: break;
      //case ts.SyntaxKind.TypeQuery: res = { type:"type query not implemented" }; break;
      //case ts.SyntaxKind.ParenthesizedType: res = { type:"parenthesized type not implemented" }; break;
      default: unknown = true; break;
    }
    if(unknown) throw(`unknown type (${typeDesc.kind}) in parameterlist`); 
  }
  else if(typeDesc.constructor.name == 'TokenObject') res = tokenObjectToJSON(typeDesc,jsDoc);
  else throw(`unknown type (${typeDesc.constructor.name})`);

  if(res) {
    let symbol = checker.getTypeFromTypeNode(typeDesc).symbol;
    if(jsDoc != null && jsDoc.length != 0) {
      for(let i = 0;i < jsDoc.length;i++) {
        if(jsDoc[i].tags != null && jsDoc[i].tags.length != 0) {
          for(let j = 0;j < jsDoc[i].tags.length;j++) applyTag(res,jsDoc[i].tags[j]);
        }
      }
    }
    if(symbol) res.description = ts.displayPartsToString(symbol.getDocumentationComment());
  }
  return res;
}

function parameterListToJSON(method: DecoratedItem):Object {
  let props = {};
  let parameterNames = [];

  for(let i = 0;i < method.methodParameters.length;i++) {
    let jsonValue = typeToJSON(method.methodParameters[i].type,null);;

    if(jsonValue) props[method.methodParameters[i].id] = jsonValue;
  }
  for(let i = 0;i < method.methodParameters.length;i++) parameterNames[i] = method.methodParameters[i].id;
  return {
    className: `${method.className}`,
    method: `${method.decorates}`,
    parameterNames:parameterNames,
    schema: {
      "$schema": "http://json-schema.org/draft-07/schema#",
      title: `${method.decorates} plist`,
      description: `Parameter list for ${method.decorates}`,
      type: "object",
      properties: props
    }
  };
}

function traverseParameterList(parms: any): TypedId[] {
  let parameterList:TypedId[] = [];

  for(let i = 0;i < parms.length;i++) {
    parameterList.push(<TypedId>{ id:parms[i].name.text, type:parms[i].type });
  }
  return parameterList;
}

function genSymtabToSchemaDefinitions(): Object {
  let res = {};

  for(let ikey in symtab) {
    let required = [];
    res[ikey] = { type:"object", properties:{} };
    for(let mkey in symtab[ikey].members) {
      res[ikey].properties[mkey] = symtab[ikey].members[mkey].desc;
      if(!symtab[ikey].members[mkey].optional) required.push(mkey);
    }
    res[ikey].required = required;
    if(symtab[ikey].comment != null) res[ikey].description = symtab[ikey].comment;
  }
  return res;
}

function genArgsToSchema(parameterNames: any): string {
  let s = '';

  s += `function(a) {\n`;
  s += `let o = {};\n`;
  s += `console.log(a);\n`;
  for(let i = 0;i < parameterNames.length;i++) {
     s += `    o['${parameterNames[i]}'] = a[${i}];\n`;
  }
  s += `  console.log(o);\n`;
  s += `  return o;\n  }\n`;
  return s;
}

function genMethodEntry(className,methodName,parameterNames,schema) {
  return `
exports["${className}.${methodName}"] = { 
  schema:compositeWithDefinitions(${JSON.stringify(schema)}),
  argsToSchema:${genArgsToSchema(parameterNames)},
  validate:ajv.compile(compositeWithDefinitions(${JSON.stringify(schema)}))
};`;
}

function genSource(items:DecoratedItem[],wstream: NodeJS.ReadWriteStream) {
  let definitions = genSymtabToSchemaDefinitions();
  let body = "";

  body += `const Ajv = require('ajv');`;
  body += `let ajv = new Ajv();`;
  body += `let definitions = ${JSON.stringify(definitions,null,2)}\n`;
  body += `function compositeWithDefinitions(schema) { schema.definitions = definitions; return schema; }`;
  wstream.write(body);
  for(let i = 0;i < items.length;i++) {
    let x = <any>parameterListToJSON(items[i]);

    if(x.parameterNames) x.schema.required = x.parameterNames;
    wstream.write(genMethodEntry(x.className,x.method,x.parameterNames,x.schema));
  }
}

function getFilenames(patterns: string[]) {
  let fa = [];

  for(let i = 0;i < patterns.length;i++) {
    let filenames = glob.sync(patterns[i]);

    for(let j = 0;j < filenames.length;j++) fa.push(filenames[j]);
  }
  return fa;
}

function generateChecks(patterns: string[],options: ts.CompilerOptions,wstream: NodeJS.ReadWriteStream): void {
  let fa = getFilenames(patterns);
  let program = ts.createProgram(fa,options);
  let output:DecoratedItem[] = [];
  let x = {};

  checker = program.getTypeChecker();
  function isNodeExported(node: ts.Node): boolean {
    return (node.flags & ts.ModifierFlags.Export) !== 0 || (node.parent && node.parent.kind === ts.SyntaxKind.SourceFile);
  }

  function visitDecorator(node: ts.Node) {
    if(ts.isDecorator(node)) {
      const expr = (<ts.Decorator>node).expression;
      let parentName = "unknown";
      let methodParameters:TypedId[] = [];
      let doRuntimeCheck = false;

      switch(node.parent.kind) {
        case ts.SyntaxKind.FunctionDeclaration:
        {
          const x = (<ts.FunctionDeclaration>(node.parent)).name;

          if(x != null) parentName = x.text;
          doRuntimeCheck = true;
        }
        break;
        case ts.SyntaxKind.MethodDeclaration:
        {  
          const x = (<ts.FunctionDeclaration>(node.parent)).name;

          if(x != null) parentName = x.text;

          let symbol = checker.getSymbolAtLocation(x);
          let type = checker.getTypeOfSymbolAtLocation(symbol,symbol.valueDeclaration);
          let typeNode = checker.typeToTypeNode(type,node.parent,ts.NodeBuilderFlags.IgnoreErrors|ts.NodeBuilderFlags.WriteTypeParametersInQualifiedName);


          methodParameters = traverseParameterList((<any>typeNode).parameters);
          doRuntimeCheck = true;

          //console.log(checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol,symbol.valueDeclaration)));
          //console.log(checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration));
          //console.log(checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration).parameters);

        }
        break;
        case ts.SyntaxKind.ClassDeclaration: /* do nothing for classes yet */
        {
          const x = (<ts.ClassDeclaration>(node.parent)).name;

          ts.forEachChild(node.parent,visit);
        }
        break;
        default: throw("unknown decorated type (" + node.parent.kind + ")");
      }

      if(ts.isCallExpression(expr) && doRuntimeCheck) {
        const cexpr = <ts.CallExpression>expr;
        const id = <ts.Identifier>cexpr.expression;
        let className = (<any>id.parent.parent.parent.parent).name.text;
        let item:DecoratedItem = { className:className, decorates:parentName, type:id.text, decoratorArgs:[], methodParameters:methodParameters };

        output.push(item);
        for(const arg of cexpr.arguments) {
          switch(arg.kind) {
            case ts.SyntaxKind.StringLiteral:
            {
              let text = tsany.getTextOfNode(arg);
              let s = text.replace(/^["']|["']$/g,'');
              
              item.decoratorArgs.push(s);
            }
            break;
            case ts.SyntaxKind.NumericLiteral:
            {
              item.decoratorArgs.push(parseFloat(tsany.getTextOfNode(arg)));
            }
            break;
            case ts.SyntaxKind.Identifier:
            {
              item.decoratorArgs.push(tsany.getTextOfNode(arg));
            }
            break;
            default: throw("unknown type (" + arg.kind + ") in decorator argument list");
          }
        }
      }
    }
  }

  function visit2(node: ts.Node) {
     let parent = node.parent;

     const intf = <ts.InterfaceDeclaration>parent;
     const x = intf.name;

     if(x != null) {
       switch(node.kind) {
         case ts.SyntaxKind.PropertySignature:
         {
           let parentName = x.text;
           let sig = <ts.PropertySignature>node;
           let name = <any>sig.name;
           let propertyName;
           let symbol = checker.getSymbolAtLocation(name);

           if(name.text) propertyName = name.text;
           if(propertyName && sig.type) {
             let jsDoc = [];
             let tags = symbol.getJsDocTags();
             let comment = ts.displayPartsToString(symbol.getDocumentationComment());
             let optional = sig.questionToken;

             if(tags.length != 0) {
               let tagSrc = ["/**"," *"];

               for(let i = 0;i < tags.length;i++) {
                 if(tags[i].name == "integer") tagSrc.push(" * @type {integer}");
                 else tagSrc.push(` * @${tags[i].name } ${tags[i].text}`);
               }
               tagSrc.push(" */");
               try {
                 wstream.write(tagSrc.join('\n'));
                 jsDoc.push(doctrine.parse(tagSrc.join('\n'),{ unwrap:true }));
               } 
               catch(e) { throw("invalid JSDoc: " + e); }
             }

             let desc = typeToJSON(sig.type,jsDoc);

             if(desc) {
               symtab[parentName].members[propertyName] = { desc:desc, optional:optional };
             }
           }
         }
         break;
       }
     }
  }

  function visit(node: ts.Node) {
    if(node.decorators != null) {
       try {
         for(const decorator of node.decorators) visitDecorator(decorator);
       }
       catch(e) {
         console.log(e);
       }
    }
    else if(isNodeExported(node)) {
      if(node.kind == ts.SyntaxKind.ClassDeclaration) {
        ts.forEachChild(node,visit);
      }
      else if(node.kind == ts.SyntaxKind.InterfaceDeclaration) {
        let name = (<ts.InterfaceDeclaration>node).name;

        if(name != null) {
          let symbol = checker.getSymbolAtLocation(name);
          let comment = ts.displayPartsToString(symbol.getDocumentationComment());
          let tags = ts.displayPartsToString(symbol.getJsDocTags());

          symtab[name.text] = { members:{}, jsDoc:null };
          symtab[name.text].comment = comment;
          if(tags != "") {
            symtab[name.text].jsDoc = doctrine.parse(tags);
            //console.log(JSON.stringify(symtab[name.text].jsDoc,null,2));
          }
          ts.forEachChild(node,visit2);
        }
      }
    }
  }

  for(const sourceFile of program.getSourceFiles()) {
    console.log("visiting file: ",sourceFile.fileName);
    ts.forEachChild(sourceFile,visit);
  }
  //fs.writeFileSync("checks.json",JSON.stringify(output,null,2));
  genSource(output,wstream);
}

module.exports = {
  generate:function(args,tsInclude,wstream) {
    let src = process.argv.slice(2);

    if(src.length == 0) src = tsInclude;
    generateChecks(src,{ target:ts.ScriptTarget.ES5, module: ts.ModuleKind.CommonJS, experimentalDecorators:true },wstream);
  }
}

