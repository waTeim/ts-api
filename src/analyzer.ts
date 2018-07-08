import * as ts from "typescript";
import * as fs from "fs";
import * as glob from "glob";
import * as doctrine from "doctrine";
import * as path from "path";

const tsany = ts as any;

interface TypedId {
  id: string,
  type: Object
};

interface DecoratedFunction {
  className: string,
  comment: string,
  decorates: string,
  decoratorArgs: any[],
  methodParameters: TypedId[],
  returnType: ts.TypeNode,
  type: string
};

interface Controller {
  args: any[],
  className: string,
  fileName: string,
  comment: string,
  methods: DecoratedFunction[],
  path: string
}

interface Router {
  args: any[],
  className: string,
  fileName: string,
  comment: string,
  methods: DecoratedFunction[],
  path: string
}

let symtab: any = {};
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
    case ts.SyntaxKind.AnyKeyword: res = { oneOf:[ { type:"object" }, { type:"number" }, { type:"string" }]}; break;
    case ts.SyntaxKind.NullKeyword: res = { type:"null" }; break;
    case ts.SyntaxKind.UndefinedKeyword: break;
    case ts.SyntaxKind.SymbolKeyword: break;
    case ts.SyntaxKind.FunctionType: break;
    default: unknown = true; break;
  }
  if(unknown) throw(`unknown type  (${o.kind}) in parameterlist`);
  else return res;
}

function maptypeDescName(docRoot: string,name: string): Object {
  if(name == "Object") return { type:"object" };
  if(name == "String") return { type:"string" };
  if(name == "Number") return { type:"number" };
  if(name == "Boolean") return { type:"boolean" };
  if(name == "Function") return null;
  return { "$ref":`${docRoot}/${name}` };
}

function unionToJSON(typeDesc:any,jsDoc:any,options?:any):Object {
   let unionDesc = <ts.UnionTypeNode>typeDesc;
   let res = { oneOf:[] };

   for(let i = 0;i < unionDesc.types.length;i++) {
     let unionElement = typeToJSON(unionDesc.types[i],null,options);

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

function typeToJSON(typeDesc:any,jsDoc:any,options?:any):Object {
  let res;

  if(typeDesc.constructor.name == 'NodeObject') {
    let unknown = false;
    let docRoot = "#/definitions";

    if(options != null && options.docRoot != null) docRoot = options.docRoot;
    switch(typeDesc.kind) {
      case ts.SyntaxKind.ArrayType: res =  { type:"array", items:typeToJSON(typeDesc.elementType,jsDoc,options) }; break;
      case ts.SyntaxKind.TypeReference: 
      {
        res =  maptypeDescName(docRoot,typeDesc.typeName.text);
        if(res != null && res['$ref'] != null && options && options.expandRefs) {
          if(symtab[typeDesc.typeName.text] == null) throw(`undefined type ${typeDesc.typeName.text}`);
          res = symtab[typeDesc.typeName.text].def;
        }
      }
      break;
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

function markUnionAsRelevant(typeDesc:any,jsDoc:any,options?:any) {
  let unionDesc = <ts.UnionTypeNode>typeDesc;

  for(let i = 0;i < unionDesc.types.length;i++) markAsRelevant(unionDesc.types[i],null,options);
}

function markAsRelevant(typeDesc:any,jsDoc:any,options?:any) {
  if(typeDesc.constructor.name == 'NodeObject') {
    switch(typeDesc.kind) {
      case ts.SyntaxKind.ArrayType: markAsRelevant(typeDesc.elementType,jsDoc,options); break;
      case ts.SyntaxKind.TypeReference:
      {
        if(symtab[typeDesc.typeName.text] == null) throw(`undefined type ${typeDesc.typeName.text}`);
        symtab[typeDesc.typeName.text].relevant = true;
      }
      break;
      case ts.SyntaxKind.UnionType: markUnionAsRelevant(typeDesc,jsDoc); break;
      default: break;
    }
  }
  else if(typeDesc.constructor.name != 'TokenObject') throw(`unknown type (${typeDesc.constructor.name})`);
}


function parameterListToJSON(method: DecoratedFunction,options?:any):Object {
  let props = {};
  let parameterNames = [];

  for(let i = 0;i < method.methodParameters.length;i++) {
    let jsonValue = typeToJSON(method.methodParameters[i].type,null,options);;

    if(jsonValue) {
      props[method.methodParameters[i].id] = jsonValue;
      markAsRelevant(method.methodParameters[i].type,null,options);
    }
  }
  for(let i = 0;i < method.methodParameters.length;i++) parameterNames[i] = method.methodParameters[i].id;
  return {
    className: `${method.className}`,
    method: `${method.decorates}`,
    parameterNames:parameterNames,
    schema: {
      //"$schema": "http://json-schema.org/draft-07/schema#",
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

function connectMethods(endpoints:DecoratedFunction[]): void {
  for(let i = 0;i < endpoints.length;i++) {
    if(endpoints[i].className != null) {
      let controller = symtab[endpoints[i].className];
            
      if(controller != null) controller.methods.push(endpoints[i]);
    }
  }
}

function symtabToSchemaDefinitions(): Object {
  let res = {};

  for(let ikey in symtab) {
    if(symtab[ikey].type == "type" && symtab[ikey].relevant) {
      let required = [];

      res[ikey] = { type:"object", properties:{} };
      for(let mkey in symtab[ikey].members) {
        res[ikey].properties[mkey] = symtab[ikey].members[mkey].desc;
        if(!symtab[ikey].members[mkey].optional) required.push(mkey);
      }
      if(required.length > 0) res[ikey].required = required;
      if(symtab[ikey].comment != null) res[ikey].description = symtab[ikey].comment;
      symtab[ikey].def = res[ikey];
    }
  }
  return res;
}

function symtabToControllerDefinitions(): Controller[] {
  let res:Controller[] = [];

  for(let ikey in symtab) {
    if(symtab[ikey].type == "controller") {
      let className = symtab[ikey].name;
      let path = className;
      let comment = symtab[className].comment;
      let fileName = symtab[className].fileName;

      if(symtab[ikey].args != null && symtab[ikey].args[0] != null) path = symtab[ikey].args[0];
      res.push({ 
        path:path,
        className:className,
        fileName:fileName,
        comment:comment,
        methods: symtab[ikey].methods,
        args: symtab[ikey].args
      });
    }
  }
  return res;
}

function symtabToRouterDefinitions(): Router[] {
  let res:Router[] = [];

  for(let ikey in symtab) {
    if(symtab[ikey].type == "router") {
      let className = symtab[ikey].name;
      let path = className;
      let comment = symtab[className].comment;
      let fileName = symtab[className].fileName;

      if(symtab[ikey].args != null && symtab[ikey].args[0] != null) path = symtab[ikey].args[0];
      res.push({
        path:path,
        className:className,
        fileName:fileName,
        comment:comment,
        methods: symtab[ikey].methods,
        args: symtab[ikey].args
      });
    }
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

function genMethodEntry(className,methodName,parameterNames,schema): string {
  return `
exports["${className}.${methodName}"] = { 
  schema:compositeWithDefinitions(${JSON.stringify(schema,null,2)}),
  argsToSchema:${genArgsToSchema(parameterNames)},
  validate:ajv.compile(compositeWithDefinitions(${JSON.stringify(schema,null,2)}))
};`;
}

function addController(className:string,fileName: string,comment: string): void {
  if(symtab[className] != null) throw("multiple references to same class: " + className);
  symtab[className] = { type:"controller", name:className, fileName:fileName, comment:comment, methods:[], args:[] };
}

function addRouter(className:string,fileName: string,comment: string): void {
  symtab[className] = { type:"router", name:className, fileName:fileName, comment:comment, methods:[], args:[] };
}

function genSwaggerPreamble(def: any,projectName:string,routers:Router[],controllers:Controller[]): void {
  let comments = "";

  for(let i = 0;i < routers.length;i++) {
    if(routers[i].comment != null && routers[i].comment != '') comments += routers[i].comment + "\n\n";
    for(let j = 0;j < controllers.length;j++) {
      if(controllers[j].comment != null && controllers[j].comment != '') {
        if(comments.length != 0) comments += "\n\n";
        comments += controllers[j].path + "\n\n";
        comments += controllers[j].comment;
      }
    }
  }
  def.openapi = "3.0.0";
  def.info = { version:"1.0.0", title:projectName };

  if(comments.length != 0) def.info.description = comments;
}

function genSwaggerTags(def: any,routers:Router[],controllers:Controller[]): void {
  let tags:any[] = [];

  for(let i = 0;i < controllers.length;i++) {
    tags.push({ path:controllers[i].path });
  }
  //def.tags = tags;
}

function genSwaggerPaths(def: any,prefix:string,controllers:Controller[]): void {
  let paths:Object = {};

  for(let i = 0;i < controllers.length;i++) {
    let methods: DecoratedFunction[] = controllers[i].methods;
    let p1 = controllers[i].path;
    let comment = controllers[i].comment;
    
    if(p1.charAt(0) == '/') p1 = p1.substring(1);
    if(p1.charAt(p1.length - 1) == '.') p1 = p1.substring(0,p1.length - 1);
    for(let j = 0;j < methods.length;j++) {
      let p2 = methods[j].decorates;
      let parameters = [];
      let methodType = methods[j].type;
      let inputForm = "query";
      let responses = {};
      let path:any = { tags:[p1], operationId:p2, parameters:parameters, responses:responses  };
      let methodComment = methods[j].comment;
      let returnTypedef;
      let returnTypename;

      if(methods[j].returnType != null) {
        returnTypedef = typeToJSON(methods[j].returnType,null);
        returnTypename = tsany.getTextOfNode((<any>methods[j].returnType).typeName);
      }
      if(returnTypename == "Promise") {
        let promiseArg = (<any>methods[j].returnType).typeArguments[0];

        returnTypedef = typeToJSON(promiseArg,null,{ expandRefs:true, docRoot:"#/components/schemas" });
      }
      if(methodComment != null && methodComment != "") path.description = methodComment;
      if(returnTypedef != null) responses["200"] = { description:"Successful response", content:{ "application/json":{ schema:returnTypedef }}};
      else responses["204"] = { description:"Successful response" };
      if(methodType == "post") inputForm = "body";
      for(let k = 0;k < methods[j].methodParameters.length;k++) {
        let parameter = methods[j].methodParameters[k];
        let parameterTypedef:any = typeToJSON(parameter.type,null,{ expandRefs:true, docRoot:"#/components/schemas" });

        if(parameterTypedef != null && parameterTypedef.type == "object") { 
          for(let pname in parameterTypedef.properties) {
            let isRequired = false;
      
            if(parameterTypedef.required != null) {
              for(let l = 0;l < parameterTypedef.required.length;l++) {
                if(parameterTypedef.required[l] == pname) isRequired = true;
              }
            }
            parameters.push({ name:pname, in:inputForm, schema:parameterTypedef.properties[pname], required:isRequired });
          }
        }
        else parameters.push({ in:inputForm, name:parameter.id, required:true, schema:parameterTypedef });
      }

      let pathId = '/' + prefix + '/' + p1 + '/' + p2;
    
      paths[pathId] = {};
      paths[pathId][methodType] = path;
    }
  }
  def.paths = paths;
}

function genSwaggerRoutes(def: any,routers:Router[],controllers:Controller[]): void {
  if(routers.length == 0) throw("No Router Definitions Found");
  for(let i = 0;i < routers.length;i++) {
    let prefix = routers[i].path;
   
    if(prefix.charAt(0) == '/') prefix = prefix.substring(1);
    if(prefix.charAt(prefix.length - 1) == '.') prefix = prefix.substring(0,prefix.length - 1);
    genSwaggerPaths(def,prefix,controllers);
  }
}


function genRoutes(endpoints:DecoratedFunction[],routers:Router[],controllers:Controller[],srcRoot: string,routesFile: NodeJS.ReadWriteStream):void {
  let output = `"use strict";\n\n`;

  output += `const express = require('express');\n`;
  output += `const api = require('ts-api');\n`;
  output += `const EndpointCheckBinding = api.EndpointCheckBinding;\n`;
  output += `const error_response = api.response.error;\n`;
  output += `const success_response = api.response.success;\n`;

  for(let i = 0;i < controllers.length;i++) {
    let fileName = path.resolve(controllers[i].fileName);

    if(srcRoot != null) {
      fileName = fileName.replace(srcRoot + '/','');
      fileName = fileName.replace(path.extname(fileName),"");
      output += `const ${controllers[i].className}Module = require('./${fileName}');\n`;
    }
    else output += `const ${controllers[i].className}Module = require('./${path.basename(fileName)}');\n`;
  }

  for(let i = 0;i < routers.length;i++) {
    let fileName = path.resolve(routers[i].fileName);

    if(srcRoot != null) {
      fileName = fileName.replace(srcRoot + '/','');
      fileName = fileName.replace(path.extname(fileName),"");
      output += `const ${routers[i].className}= require('./${fileName}');\n`;
    }
    else output += `const ${routers[i].className}= require('./${path.basename(fileName)}');\n`;
  }

  output += `\nlet binding = new EndpointCheckBinding(require('./__check'));\n`;
  output += `\nmodule.exports = function(app) {\n`;
  output += `  let pods = [];\n`;

  for(let i = 0;i < routers.length;i++) {
    let prefix = routers[i].path;

    if(prefix.charAt(0) == '/') prefix = prefix.substring(1);
    if(prefix.charAt(prefix.length - 1) == '.') prefix = prefix.substring(0,prefix.length - 1);

    if(i != 0) output += '\n';
    output += `  let pod = new ${routers[i].className}.default(app);\n\n`;

    output += `  pods.push(pod);\n`;

    for(let j = 0;j < controllers.length;j++)
      output += `  pod.addRouter('${controllers[j].className}');\n`;

    for(let j = 0;j < endpoints.length;j++) {
      let rfunc = endpoints[j].type;
      let endpointName = endpoints[j].decorates;
      let path = endpointName;
  
      if(endpoints[j].decoratorArgs.length != 0) path = endpoints[j].decoratorArgs[0];

      output += `\n`;
      output += `  pod.getRouter('${endpoints[j].className}').${rfunc}('/${path}', async(req,res,next) => {\n`;
      output += `    try {\n`;
      output += `      const controller = new ${endpoints[j].className}Module.default(app,binding,req,res,next);\n`;
      if(rfunc == 'get') output += `      const x = await controller.${endpointName}(req.query);\n\n`;
      else output += `      const x = await controller.${endpointName}(req.body);\n\n`;
      output += `      success_response(x,req,res,next);\n`;
      output += `    }\n`;
      output += `    catch(e) { error_response(e,req,res,next); }\n`;
      output += `  });\n`;
    }

    for(let j = 0;j < controllers.length;j++) {
      let path = controllers[j].path;

      if(path.charAt(0) == '/') path = path.substring(1);
      if(path.charAt(prefix.length - 1) == '.') path = prefix.substring(0,path.length - 1);

      output += `  app.use('/${prefix}/${path}',pod.getRouter('${controllers[j].className}'));\n`;
    }
  }

  output += `  return pods;\n`;
  output += `}\n`;

  routesFile.write(output);
}

function genSources(items:DecoratedFunction[],packageName: string,srcRoot: string,checkFile: NodeJS.ReadWriteStream,swaggerFile: NodeJS.ReadWriteStream,routesFile: NodeJS.ReadWriteStream) {
  let controllers:Controller[] = symtabToControllerDefinitions();
  let routers:Router[] = symtabToRouterDefinitions();
  let swaggerDefinitions:any = {};
  let contents_part1 = '';
  let contents_part2 = '';
  let contents_part3 = '';

  contents_part1 += `\n\nconst Ajv = require('ajv');\n`;
  contents_part1 += `\nlet ajv = new Ajv({ coerceTypes: true });\n`;

  contents_part3 += `\nfunction compositeWithDefinitions(schema) { schema.definitions = definitions; return schema; }\n`;

  for(let i = 0;i < items.length;i++) {
    let x = <any>parameterListToJSON(items[i]);

    if(x.parameterNames) x.schema.required = x.parameterNames;
    contents_part3 += genMethodEntry(x.className,x.method,x.parameterNames,x.schema);
  }

  let definitions = symtabToSchemaDefinitions();

  contents_part2 += `\n\nlet definitions = ${JSON.stringify(definitions,null,2)}\n`;

  checkFile.write(contents_part1);
  checkFile.write(contents_part2);
  checkFile.write(contents_part3);

  genSwaggerPreamble(swaggerDefinitions,packageName,routers,controllers);
  genSwaggerTags(swaggerDefinitions,routers,controllers);
  genSwaggerRoutes(swaggerDefinitions,routers,controllers);
  swaggerDefinitions.components = { schemas:definitions };
  swaggerFile.write(`${JSON.stringify(swaggerDefinitions,null,2)}\n`);
  genRoutes(items,routers,controllers,srcRoot,routesFile);
}

function getFilenames(patterns: string[]) {
  let fa = [];

  for(let i = 0;i < patterns.length;i++) {
    let filenames = glob.sync(patterns[i]);

    for(let j = 0;j < filenames.length;j++) fa.push(filenames[j]);
  }
  return fa;
}

function genArgumentList(cexpr: ts.CallExpression) {
  let argList = [];

  for(const arg of cexpr.arguments) {
    switch(arg.kind) {
      case ts.SyntaxKind.StringLiteral:
      {
        let text = tsany.getTextOfNode(arg);
        let s = text.replace(/^["']|["']$/g,'');

        argList.push(s);
      }
      break;
      case ts.SyntaxKind.NumericLiteral:
      {
        argList.push(parseFloat(tsany.getTextOfNode(arg)));
      }
      break;
      case ts.SyntaxKind.Identifier:
      {
        argList.push(tsany.getTextOfNode(arg));
      }
      break;
      case ts.SyntaxKind.FunctionExpression: console.log("ignoring function in decorator argument list"); break;
      default: throw("unknown type (" + arg.kind + ") in decorator argument list");
    }
  }
  return argList;
}

function generate(patterns: string[],options: ts.CompilerOptions,packageName: string,srcRoot: string,checkFile: NodeJS.ReadWriteStream,swaggarFile: NodeJS.ReadWriteStream,routesFile: NodeJS.ReadWriteStream): void {
  let fa = getFilenames(patterns);
  let program = ts.createProgram(fa,options);
  let endpoints:DecoratedFunction[] = [];
  let x = {};

  checker = program.getTypeChecker();
  function isNodeExported(node: ts.Node): boolean {
    return (node.flags & ts.ModifierFlags.Export) !== 0 || (node.parent && node.parent.kind === ts.SyntaxKind.SourceFile);
  }

  function visitDecorator(node: ts.Node) {
    if(ts.isDecorator(node)) {
      const expr = (<ts.Decorator>node).expression;
      let dsym = checker.getSymbolAtLocation(expr.getFirstToken());
      let dname = dsym.getName();
      let parentName = "unknown";
      let methodParameters:TypedId[] = [];
      let doRuntimeCheck = false;
      let doDecoratedClass = false;
      let returnType;
      let comment;

      switch(node.parent.kind) {
        case ts.SyntaxKind.FunctionDeclaration:
        {
          let name = (<ts.FunctionDeclaration>(node.parent)).name;

          if(name != null) {
            let symbol = checker.getSymbolAtLocation(name);

            parentName = name.text;
            comment = ts.displayPartsToString(symbol.getDocumentationComment());
          }
          returnType = (<ts.FunctionDeclaration>node.parent).type;
          doRuntimeCheck = true;
        }
        break;
        case ts.SyntaxKind.MethodDeclaration:
        {  
          if(dname == "get" || dname == "post") {
            let x = (<ts.FunctionDeclaration>(node.parent)).name;

            if(x != null) parentName = x.text;

            let symbol = checker.getSymbolAtLocation(x);
            let type = checker.getTypeOfSymbolAtLocation(symbol,symbol.valueDeclaration);
            let typeNode = checker.typeToTypeNode(type,node.parent,ts.NodeBuilderFlags.IgnoreErrors|ts.NodeBuilderFlags.WriteTypeParametersInQualifiedName);
          
            comment = ts.displayPartsToString(symbol.getDocumentationComment());
            returnType = (<ts.MethodDeclaration>node.parent).type;
            methodParameters = traverseParameterList((<any>typeNode).parameters);
            doRuntimeCheck = true;
          }
        }
        break;
        case ts.SyntaxKind.ClassDeclaration:
        {
          let classNameNode = (<ts.ClassDeclaration>(node.parent)).name;
          let className = classNameNode.text;
          let symbol = checker.getSymbolAtLocation(classNameNode);
          let source = <ts.SourceFile>(node.parent.parent);

          comment = ts.displayPartsToString(symbol.getDocumentationComment());
          ts.forEachChild(node.parent,visit);
          if(dname == "controller") {
            addController(className,source.fileName,comment);
            doDecoratedClass = true;
          }
          else if(dname == "router") {
            addRouter(className,source.fileName,comment);
            doDecoratedClass = true;
          }
        }
        break;
        default: throw("unknown decorated type (" + node.parent.kind + ")");
      }

      if(ts.isCallExpression(expr)) {
        const cexpr = <ts.CallExpression>expr;
        const id = <ts.Identifier>cexpr.expression;

        if(doRuntimeCheck) {
          let className = (<any>id.parent.parent.parent.parent).name.text;
          let item:DecoratedFunction = { 
            className:className,
            comment:comment,
            decorates:parentName,
            decoratorArgs:genArgumentList(cexpr),
            methodParameters:methodParameters,
            returnType:returnType,
            type:id.text
          };

          endpoints.push(item);
        }
        else if(doDecoratedClass) {
          let classNameNode = (<ts.ClassDeclaration>(node.parent)).name;
          let entry = symtab[classNameNode.text];

          entry.args = genArgumentList(cexpr);
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
                 checkFile.write(tagSrc.join('\n'));
                 jsDoc.push(doctrine.parse(tagSrc.join('\n'),{ unwrap:true }));
               } 
               catch(e) { throw("invalid JSDoc: " + e); }
             }

             let desc = typeToJSON(sig.type,jsDoc,{ docRoot:"#/components/schemas" });

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
      let name = (<ts.ClassDeclaration>node).name;
      let symbol;    
      let comment;
 
      if(name != null) symbol = checker.getSymbolAtLocation(name);
      if(name != null) comment = ts.displayPartsToString(symbol.getDocumentationComment());
      if(node.kind == ts.SyntaxKind.ClassDeclaration) {
        ts.forEachChild(node,visit);
        symtab[name.text] = { type:"type", members:{}, jsDoc:null };
        symtab[name.text].comment = comment;
      }
      else if(node.kind == ts.SyntaxKind.InterfaceDeclaration) {
        if(name != null) {
          let tags = ts.displayPartsToString(symbol.getJsDocTags());

          symtab[name.text] = { type:"type", members:{}, jsDoc:null };
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
  connectMethods(endpoints);
  genSources(endpoints,packageName,srcRoot,checkFile,swaggarFile,routesFile);
}

module.exports = {
  generate:function(env,checkFile,swaggerFile,routesFile) {
    let src = env.programArgs.slice(2);

    if(src.length == 0) src = env.tsInclude;
    generate(src,{ target:ts.ScriptTarget.ES5, module: ts.ModuleKind.CommonJS, experimentalDecorators:true },env.packageName,env.srcRoot,checkFile,swaggerFile,routesFile);
  }
}

