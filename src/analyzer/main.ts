import * as ts from "typescript";
import * as glob from "glob";
import * as doctrine from "doctrine";

const tsany = ts as any;

import { TypedId, PathDecomposition, DecoratedFunction, Controller, Router } from "./types";
import { checker, getIndex, setChecker, symtab, symtabGet, symtabPut, typeToJSON } from "./symtab";
import { 
  addController,
  addRouter,
  connectMethods,
  findRelevant,
  genMethodEntry,
  parameterListToJSON,
  symtabToSchemaDefinitions,
  symtabToControllerDefinitions,
  symtabToRouterDefinitions,
  traverseParameterList
} from "./traverse";
import { genSwaggerPreamble, genSwaggerRootTags, genSwaggerRoutes } from "./swagger";
import { genExpressRoutes } from "./express_routes";
import { genRedoc } from "./redoc";

/**
 * Generate source given the definitions inicated by annotations in the source code.  These
 * sources include __router.js __check.js and docs/swagger.json.  By default these files will
 * be created in the destination directory as defined by the tsconfig file.
 *
 * @param {DecoratedFunction[]} items array of endpoint methods that correspond to express routes
 * and swagger paths.
 * @param {string} packageName name of the package (from package.json).  This will be converted to
 * the swagger title.
 * @param {string} srcRoot location of the source code (from tsconfig.json).
 * @param {NodeJS.ReadWriteStream} checkFile reference to the file __check.js
 * @param {NodeJS.ReadWriteStream} swaggerFile reference to the file docs/swagger.json
 * @param {NodeJS.ReadWriteStream} routesFiles reference to the file __routes.js
 */
function genSources(
 items:DecoratedFunction[],
 packageName: string,
 srcRoot: string,
 checkFile: NodeJS.ReadWriteStream,
 swaggerFile: NodeJS.ReadWriteStream,
 redocFile: NodeJS.ReadWriteStream,
 routesFile: NodeJS.ReadWriteStream
) {
  let controllers:Controller[] = symtabToControllerDefinitions();
  let routers:Router[] = symtabToRouterDefinitions();
  let swaggerDefinitions:any = {};
  let contents_part1 = '';
  let contents_part2 = '';
  let contents_part3 = '';

  if(routers.length == 0) throw("No Router Definitions Found");
  if(routers.length > 1) throw("Multiple Router Definitions Found");

  contents_part1 += `const Ajv = require('ajv');\n`;
  contents_part1 += `\nlet ajv = new Ajv({ coerceTypes: true });\n\n`;
  contents_part1 += `ajv.addKeyword('toDate', {\n`;
  contents_part1 += `  modifying: true,\n`;
  contents_part1 += `  schema: false, \n`;
  contents_part1 += `  valid: true, \n`;
  contents_part1 += `  validate: function(data,dataPath,parentData,parentDataProperty) {\n`;
  contents_part1 += `    if(typeof data == "string" && parentData != null) parentData[parentDataProperty] = new Date(data);\n`;
  contents_part1 += `  }\n`;
  contents_part1 += `});\n\n`;
  contents_part1 += `ajv.addKeyword('precision', {\n`;
  contents_part1 += `  schema: true,\n`;
  contents_part1 += `  validate: function(schema,data) {\n`;
  contents_part1 += `    let x = data - Math.floor(data);\n`;
  contents_part1 += `    let m = Math.pow(10,schema);\n`;
  contents_part1 += `    let y = x*m;\n`;
  contents_part1 += `    \n`;
  contents_part1 += `    return y == Math.floor(y);\n`;
  contents_part1 += `  }\n`;
  contents_part1 += `});\n`;

  contents_part3 += `\nfunction compositeWithDefinitions(schema) { schema.definitions = definitions; return schema; }\n`;
  contents_part3 += `function validate(schema) { try { return ajv.compile(compositeWithDefinitions(schema)); } catch(e) { throw new Error(e); } }\n`;

  for(let i = 0;i < items.length;i++) findRelevant(items[i]);

  let definitions1 = symtabToSchemaDefinitions("check","#/definitions");
  let definitions2 = symtabToSchemaDefinitions("swagger","#/components/schemas",{ firstclassIntermediates:true });
  let synthesizedTypes = {};

  for(let i = 0;i < items.length;i++) {
    let x = <any>parameterListToJSON(items[i]);

    if(x.parameterNames) x.schema.required = x.required;
    contents_part3 += genMethodEntry(x.classRef,x.method,x.parameterNames,x.schema,x.passthrough);
  }

  contents_part2 += `\n\nlet definitions = ${JSON.stringify(definitions1,null,2)}\n`;

  checkFile.write(contents_part1);
  checkFile.write(contents_part2);
  checkFile.write(contents_part3);

  genSwaggerPreamble(swaggerDefinitions,packageName,routers[0],controllers);
  genSwaggerRootTags(swaggerDefinitions,routers[0],controllers);
  genSwaggerRoutes(swaggerDefinitions,synthesizedTypes,routers[0],controllers);
  for(let synthesizedTypename in synthesizedTypes) definitions2[synthesizedTypename] = synthesizedTypes[synthesizedTypename];
  swaggerDefinitions.components = { schemas:definitions2 };
  swaggerFile.write(`${JSON.stringify(swaggerDefinitions,null,2)}\n`);

  let swaggerPath = genExpressRoutes(items,routers[0],controllers,srcRoot,routesFile);

  genRedoc(swaggerPath,redocFile);
}

/**
 * Use glob to contruct the list of input files to scan given a list of glob-type
 * patterns.
 *
 * @param {string[]} patterns array of glob-patterns describing the list of files.
 */
function getFilenames(patterns: string[]) {
  let fa = [];

  for(let i = 0;i < patterns.length;i++) {
    let filenames = glob.sync(patterns[i]);

    for(let j = 0;j < filenames.length;j++) fa.push(filenames[j]);
  }
  return fa;
}

/**
 * Extract arguments of relevant decorators for static analysis.  Some arguments
 * to decorators are needed at compile time for file generation (e.g. @controller 
 * path).  This function finds these values for use later on in the 2nd pass.
 * Literal values can be used, but arguements only usable at runtime are ignored.
 *
 * @param {ts.CallExpression} cexpr AST subtree rooted with decorator type node.
 */
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
      case ts.SyntaxKind.FunctionExpression: console.log("   ignoring function in decorator argument list"); break;
      default: throw("unknown type (" + arg.kind + ") in decorator argument list");
    }
  }
  return argList;
}

/**
 * Main entry point for static analysis of a list of typescript files.  Given the list
 * of files, invokes the typescript parser and typechecker APIs, and then using the
 * resulting AST from that pass, generate file appropriate for the following objectives
 *
 * 1. Creation of runtime checking routines. Construct a JSON schema for each appropriatedly
 * annotated method and a function that will apply a schema check to that argument list.
 * Place these functions in __check.js
 *
 * 2. Assembly of express type routes.  Generate a file __routes that will create appropriate
 * objects and connect them to express using one or more express Router classes.  Apply
 * runtime checking in 1. as part of that route.
 *
 * 3. Generate analogous Swagger doc.  Create a swagger document that corresponds to the 
 * routes created by 2.
 *
 * @param {string[]} patterns list of source file patters to analyze.
 * @param {ts.CompilerOptions} options options controlling behavior of the typescript parser
 * and type checker
 * @param {string} packageName derived from package.json of the input project.  Use for top level naming.
 * @param {string} srcRoot root of the source directory (derived form tsconfig.json by default).
 * @param {NodeJS.ReadWriteStream} checkFile reference to the generated file __check.js
 * @param {NodeJS.ReadWriteStream} swaggerFile reference to the generated file docs/swagger.json
 * @param {NodeJS.ReadWriteStream} routesFile reference to the generated file __routes.js
 */
export function generate(
 patterns: string[],
 options: ts.CompilerOptions,
 packageName: string,
 srcRoot: string,
 checkFile: NodeJS.ReadWriteStream,
 swaggerFile: NodeJS.ReadWriteStream,
 redocFile: NodeJS.ReadWriteStream,
 routesFile: NodeJS.ReadWriteStream,
 debugMode: boolean
): void {
  let fa = getFilenames(patterns);
  let program = ts.createProgram(fa,options);
  let endpoints:DecoratedFunction[] = [];
  let x = {};
  let defComp = [];

  setChecker(program);
  function isNodeExported(node: ts.Node): boolean {
    return (node.flags & ts.ModifierFlags.Export) !== 0 || (node.parent && node.parent.kind === ts.SyntaxKind.SourceFile);
  }

  // Recurse over all of the decorated functions, classes, etc and extract
  // relevant information and place that in a symbol table for later processing.
  function visitDecorator(node: ts.Node) {
    if(ts.isDecorator(node)) {
      const expr = (<ts.Decorator>node).expression;
      let dsym = checker.getSymbolAtLocation(expr.getFirstToken());
      let dname = dsym.getName();
      let parentIndex = "unknown";
      let methodParameters:TypedId[] = [];
      let doRuntimeCheck = false;
      let doDecoratedClass = false;
      let functionName;
      let returnType;
      let comment;

      switch(node.parent.kind) {
        case ts.SyntaxKind.FunctionDeclaration:
        {
          let parent:ts.FunctionDeclaration = <ts.FunctionDeclaration>node.parent;

          if(parent.name != null) {
            let symbol = checker.getSymbolAtLocation(parent.name);

            comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
          }
          returnType = parent.type;
          functionName = (<any>parent.name).text;
          doRuntimeCheck = true;
        }
        break;
        case ts.SyntaxKind.MethodDeclaration:
        {  
          if(dname == "get" || dname == "post" || dname == "put" || dname == "del" || dname == "all") {
            let parent:ts.MethodDeclaration = <ts.MethodDeclaration>node.parent;
            let symbol = checker.getSymbolAtLocation(parent.name);
         
            parentIndex = getIndex(symbol);

            let type = checker.getTypeOfSymbolAtLocation(symbol,symbol.valueDeclaration);
            let typeNode = checker.typeToTypeNode(type,node.parent,ts.NodeBuilderFlags.IgnoreErrors|ts.NodeBuilderFlags.WriteTypeParametersInQualifiedName);
            let parameterContext = parent.parameters;
          
            comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
            returnType = parent.type;

            let parms = (<any>typeNode).parameters;
            let parmContext = parent.parameters;
            let decoratorMeta = {};

            for(let i = 0;i < parmContext.length;i++) {
              if(parmContext[i].decorators != null) {
                for(let j = 0;j < parmContext[i].decorators.length;j++) {
                  const dec = (<ts.Decorator>parmContext[i].decorators[j]).expression;
                  let dsym = checker.getSymbolAtLocation(dec.getFirstToken());
                  let dname = dsym.getName();
                  let parmDecl:ts.ParameterDeclaration = <ts.ParameterDeclaration>dec.parent;
                  let psym = checker.getSymbolAtLocation(parmDecl.parent.name);
                  let pname = psym.getName();
                  let decArgList;
                  
                  if(ts.isCallExpression(dec)) {
                    decArgList = genArgumentList(<ts.CallExpression>dec);
                  }
                  if(decArgList == null) decArgList = [];
                  if(decoratorMeta[pname] == null) decoratorMeta[pname] = {};
                  decoratorMeta[pname][dname] = decArgList;
                }
              }
            }

            methodParameters = traverseParameterList((<any>typeNode).parameters,decoratorMeta);
            functionName = (<any>parent.name).text;
            doRuntimeCheck = true;
          }
        }
        break;
        case ts.SyntaxKind.ClassDeclaration:
        {
          let parent:ts.ClassDeclaration = <ts.ClassDeclaration>node.parent;
          let symbol = checker.getSymbolAtLocation(parent.name);
          let source = <ts.SourceFile>(parent.parent);

          parentIndex = getIndex(symbol);
          comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
          if(dname == "controller") {
            addController(parentIndex,source.fileName,comment);
            doDecoratedClass = true;
          }
          else if(dname == "router") {
            addRouter(parentIndex,source.fileName,comment);
            doDecoratedClass = true;
          }
          ts.forEachChild(parent,visit);
        }
        break;
        default: {
          let parent = node.parent;

          throw("unknown decorated type (" + parent.kind + ")");
        }
      }

      if(ts.isCallExpression(expr)) {
        const cexpr = <ts.CallExpression>expr;
        const id = <ts.Identifier>cexpr.expression;
        let type = id.text;

        if(type == "del") type = "delete";
        if(doRuntimeCheck) {
          let symbol = checker.getSymbolAtLocation((<any>id.parent.parent.parent.parent).name);
          let index = getIndex(symbol);
          let decoratorArgs = genArgumentList(cexpr);
          let sentry = symtabGet(index);

          let item:DecoratedFunction = { 
            index:index,
            classRef:sentry.schemaRefId,
            comment:comment,
            name:functionName,
            decoratorArgs:decoratorArgs,
            methodParameters:methodParameters,
            returnType:returnType,
            type:type
          };

          endpoints.push(item);
        }
        else if(doDecoratedClass) {
          let entry = symtabGet(parentIndex);

          entry.args = genArgumentList(cexpr);
        }
      }
    }
  }

  function saveObjectProperty(parentIndex:any,name:ts.PropertyName,typeDesc:ts.TypeNode,optional:boolean) {
    let symbol = checker.getSymbolAtLocation(name);
    let propertyName = tsany.getTextOfNode(name);

    if(propertyName != null && typeDesc != null) {
      let jsDoc = [];
      let tags = symbol.getJsDocTags();
      let comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));

      if(tags.length != 0) {
        let tagSrc = ["/**"," *"];

        for(let i = 0;i < tags.length;i++) {
          if(tags[i].name == "integer") tagSrc.push(" * @type {integer}");
          else tagSrc.push(` * @${tags[i].name} ${tags[i].text}`);
        }
        tagSrc.push(" */");
        try {
          //checkFile.write(tagSrc.join('\n'));
          jsDoc.push(doctrine.parse(tagSrc.join('\n'),{ unwrap:true }));
        }
        catch(e) { throw("invalid JSDoc: " + e); }
      }

      // Create and save the JSON schema definition for a property for later use
      // Save the args to invoke the call later.  This is necessary due to out
      // of order definitions of child member types.

      defComp.push({
        sentry:symtabGet(parentIndex),
        propertyName:propertyName,
        type:typeDesc,
        jsDoc:jsDoc,
        check:{ schemaNamespace:"check", docRoot:"#/definitions" },
        swagger:{ enclosedBy:parentIndex, options:{ schemaNamespace:"swagger", docRoot:"#/components/schemas", firstclassIntermediates:true }},
        optional:optional
      });
    }
  }


  // Analyze the contents of a an interface or class declaration collect typing information
  // and JSDoc style comments.
  function visit2(node: ts.Node) {
    let parent = node.parent;
    let x;

    if(parent.kind == ts.SyntaxKind.InterfaceDeclaration) x = (<ts.InterfaceDeclaration>parent).name;
    else if(parent.kind == ts.SyntaxKind.ClassDeclaration) x = (<ts.ClassDeclaration>parent).name;

    if(x != null) {
      let parentSymbol = checker.getSymbolAtLocation(x);
      let index = getIndex(parentSymbol);
      
      switch(node.kind) {
        case ts.SyntaxKind.PropertySignature:
        {
          // This will be the property node type if the parent is an interface

          let sig = <ts.PropertySignature>node;
          let name = <any>sig.name;
          let optional = (sig.questionToken != null);

          saveObjectProperty(index,name,sig.type,optional);
        }
        break;
        case ts.SyntaxKind.PropertyDeclaration:
        {
          // This will be the property node type if the parent is a class

          let pdecl = <ts.PropertyDeclaration>node;
          let name = <any>pdecl.name;
          let optional = (pdecl.questionToken != null);

          saveObjectProperty(index,name,pdecl.type,optional);
        }
        break;
      }
    }
  }

  function compileProperties() {
    for(let i = 0;i < defComp.length;i++) {
      let checkDef = typeToJSON(defComp[i].type,defComp[i].jsDoc,defComp[i].check);
      let swaggerDef = typeToJSON(defComp[i].type,defComp[i].jsDoc,defComp[i].swagger);

      if(checkDef != null && swaggerDef != null) {
        defComp[i].sentry.members[defComp[i].propertyName] = { desc:{ check:checkDef, swagger:swaggerDef }, type:defComp[i].type, optional:defComp[i].optional };
      }
    }
  }

  function compileInheritance(sentry:any,heritageClauses:ts.NodeArray<ts.HeritageClause>) {
    if(heritageClauses != null) {
      ts.visitNodes(heritageClauses,function(n:ts.Node):ts.VisitResult<ts.Node> {
        let h:ts.HeritageClause = <ts.HeritageClause>n;

        ts.visitNodes(h.types,function(n:ts.Node):ts.VisitResult<ts.Node> {
          let hType:ts.ExpressionWithTypeArguments = <ts.ExpressionWithTypeArguments>n;
          let expr = hType.expression;

          if(expr != null) {
            let baseName;

            switch(expr.kind) {
              case ts.SyntaxKind.Identifier: baseName = <ts.Identifier>expr; break;
              case ts.SyntaxKind.PropertyAccessExpression: baseName = (<ts.PropertyAccessExpression>expr).name; break;
              default: throw("unknown inheritance source");
            }

            let baseRef = checker.getSymbolAtLocation(baseName);
            let baseIndex = getIndex(baseRef);

            sentry.inherits.push(baseIndex);
          }
          return n;
        });
        return n;
      });
    }
  }

  // Recursively analyze an exported member of a source file.  Relevant
  // members include classes and interfaces and other refrenced types.
  function visit(node: ts.Node) {

    if(node.decorators != null) {
      try {
        for(const decorator of node.decorators) visitDecorator(decorator);
      }
      catch(e) {
        console.log(e);
      }
    }
    else if(tsany.isDeclaration(node)) {
      let decl:ts.DeclarationStatement = <ts.DeclarationStatement>node;
      let name = decl.name;
      let type;
      let symbol;    
      let comment;
      let index;
      let typeDesc;

      if(name != null) {
        symbol = checker.getSymbolAtLocation(name);
        comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
        index = getIndex(symbol);

        let type = checker.getDeclaredTypeOfSymbol(symbol);

        typeDesc = checker.typeToTypeNode(type,node,ts.NodeBuilderFlags.IgnoreErrors|ts.NodeBuilderFlags.WriteTypeParametersInQualifiedName);
      }
      if(decl.kind == ts.SyntaxKind.TypeAliasDeclaration) {
        let alias = <ts.TypeAliasDeclaration>decl;

        ts.forEachChild(decl,visit);
        symtabPut(index,{ kind:"type", decl:node, typeDesc:typeDesc, members:{}, jsDoc:null, comment:comment });
      }
      else if(decl.kind == ts.SyntaxKind.ClassDeclaration) {
        let classDecl = <ts.ClassDeclaration>decl;
        let tags = ts.displayPartsToString(symbol.getJsDocTags());
        let sentry = symtabPut(index,{ kind:"type", decl:node, typeDesc:typeDesc, members:{}, inherits:[], jsDoc:null, comment:comment });

        if(tags != "") sentry.jsDoc = doctrine.parse(tags);
        ts.forEachChild(decl,visit2);
        compileInheritance(sentry,classDecl.heritageClauses);
      }
      else if(decl.kind == ts.SyntaxKind.InterfaceDeclaration) {
        if(index != null) {
          let intfDecl = <ts.InterfaceDeclaration>decl;
          let tags = ts.displayPartsToString(symbol.getJsDocTags());
          let sentry:any = symtabPut(index,{ kind:"type", decl:node, typeDesc:typeDesc, members:{}, inherits:[], jsDoc:null, comment:comment });

          if(tags != "") sentry.jsDoc = doctrine.parse(tags);
          ts.forEachChild(decl,visit2);
          compileInheritance(sentry,intfDecl.heritageClauses);
        }
      }
    }
  }

  // Loop over all the source files and recursively analyze each
  // exported member of that file.  Build a symbol table containing
  // relevant information, and then generate new source for 
  // automatic REST endpoints (which typeshcekcing) as well as
  // accompanying swagger.
  for(const sourceFile of program.getSourceFiles()) {
    if(debugMode === true) {
      console.log("visiting file: ",sourceFile.fileName);
    }
    ts.forEachChild(sourceFile,visit);
  }
  compileProperties();
  connectMethods(endpoints);
  genSources(endpoints,packageName,srcRoot,checkFile,swaggerFile,redocFile,routesFile);
}
