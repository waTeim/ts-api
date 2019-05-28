import * as ts from "typescript";
import * as doctrine from "doctrine";
import * as path from "path";

const tsany = ts as any;

import { TypedId, PathDecomposition, DecoratedFunction, Controller, Router } from "./types";
import { checker, getIndex, mapTypeDescName, symtab, symtabGet, symtabPut, typeToJSON } from "./symtab";

/** 
 * This function marks all component types of a union type that is relevant as also relevant.
 *
 *  @param {any} typeDesc Reference to the AST substree describing the type.
 *  @param {any} jsDoc The associated JSDoc comment.
 *  @param {any} options Affects the rules governing the recursion.
 */
function markUnionAsRelevant(typeDesc:any,jsDoc:any,options?:any) {
  let unionDesc = <ts.UnionTypeNode>typeDesc;

  for(let i = 0;i < unionDesc.types.length;i++) markAsRelevant(unionDesc.types[i],null,options);
}

/**
 * This function marks all component types of an intersection type that is relevant as also relevant.
 *
 *  @param {any} typeDesc Reference to the AST substree describing the type.
 *  @param {any} jsDoc The associated JSDoc comment.
 *  @param {any} options Affects the rules governing the recursion.
 */
function markIntersectionAsRelevant(typeDesc:any,jsDoc:any,options?:any) {
  let intersectionDesc = <ts.IntersectionTypeNode>typeDesc;

  for(let i = 0;i < intersectionDesc.types.length;i++) markAsRelevant(intersectionDesc.types[i],null,options);
}

/**
 * This function marks a type as relevant.  The purpose of marking a type relevant is to 
 * reduce the number of elements that appear in a describing document.  Otherwise not only would
 * al declared types by output, so too would all typescript built-in types which would lead
 * to an unnecessarily enormous document.  The expectation is that any class that is annotated
 * with a decorator relevant to this project and any type used in a method that is likewise
 * decorated as well as all of the types that help define those aformentioned types would be
 * relevant in this way.  Thus this function is call for those types and then recursively
 * calls itself for an component types.
 *
 *  @param {any} typeDesc Reference to the AST substree describing the type.
 *  @param {any} jsDoc The associated JSDoc comment.
 *  @param {any} options Affects the rules governing the recursion.
 */
function markAsRelevant(typeDesc:any,jsDoc:any,options?:any) {
  if(typeDesc.constructor.name == 'NodeObject') {
    switch(typeDesc.kind) {
      case ts.SyntaxKind.ArrayType: markAsRelevant(typeDesc.elementType,jsDoc,options); break;
      case ts.SyntaxKind.TypeReference:
      {
        let alias = <ts.TypeAliasDeclaration>typeDesc;
        let index = getIndex(typeDesc);
        let args = (<any>typeDesc).typeArguments;
        let ref:any = symtabGet(index);

        if(ref == null) {
          throw(`undefined type ${index} in relevancy tree`);
        }
        ref.relevant = true;
        if(args != null) {
          for(let i = 0;i < args.length;i++) markAsRelevant(args[i],jsDoc,options);
        }
        for(let key in ref.members) {
          markAsRelevant(ref.members[key].type,jsDoc,options);
        }
        if(ref.decl != null && ref.decl.type != null) markAsRelevant(ref.decl.type,jsDoc,options);
        if(ref.inherits != null) {
          for(let i = 0;i < ref.inherits.length;i++) {
            let baseEntry = symtabGet(ref.inherits[i]);

            markAsRelevant(baseEntry.typeDesc,baseEntry.jsDoc,baseEntry.options);
          }
        }
      }
      break;
      case ts.SyntaxKind.UnionType: markUnionAsRelevant(typeDesc,jsDoc,options); break;
      case ts.SyntaxKind.IntersectionType: markIntersectionAsRelevant(typeDesc,jsDoc,options); break;
      default: break;
    }
  }
}

export function synthesizeParameterJSDoc(parm:TypedId) {
  let jsDoc;
  let jsDocSrc = [];
  let type1 = ["format","pattern","type"];
  let type2 = ["minimum","maximum","minLength","maxLength","minItems","maxItems","precision"];


  if(parm.decorators != null ) {
    for(let decoratorName in parm.decorators) {
      if(type1.indexOf(decoratorName) > -1 && parm.decorators[decoratorName].length >= 1) {
        if(jsDocSrc.length == 0) jsDocSrc.push('/**');
        jsDocSrc.push(` * @${decoratorName} {${parm.decorators[decoratorName][0]}}`);
      }
      else if(type2.indexOf(decoratorName) > -1 && parm.decorators[decoratorName].length >= 1) {
        if(jsDocSrc.length == 0) jsDocSrc.push('/**');
        jsDocSrc.push(` * @${decoratorName} ${parm.decorators[decoratorName][0]}`);
      }
    }
    if(jsDocSrc.length != 0) {
      jsDocSrc.push(" */");
      jsDoc = doctrine.parse(jsDocSrc.join('\n'),{ unwrap:true });
      if(jsDoc != null) jsDoc = [jsDoc];
    }
  }
  return jsDoc;
}

export function findRelevant(method: DecoratedFunction,options?:any) {
  markAsRelevant(method.returnType,null,options);

  for(let i = 0;i < method.methodParameters.length;i++) {
    let x = typeToJSON(method.methodParameters[i].type,null,options);

    if(x != null) markAsRelevant(method.methodParameters[i].type,null,options);
  }
}

/**
 * This function constructs the JSON schema corresponding to the method parameter
 * list. This is accomplished by contstructing the schema corresponding to a virtual
 * aggregate type whose members are each a parameter to the method. To apply a JSON
 * schema type checker is a matter of contructing an intermediate form corresponding
 * to that virtual type -- this is done by the generated function argsToSchema found
 * in __check.js.  Each parameter type is marked to include in the reference schema
 * definitions.
 *
 * @param {DecoratedFunction} method the definition of the method having the parameter
 * list for which the schema is to be contstructed.
 * @param {any} options affects the rules for schema creation.
 * 
 */
export function parameterListToJSON(method: DecoratedFunction,options?:any):Object {
  let props = {};
  let parameterNames = [];
  let required = [];
  let passthrough = false;

  if(method.methodParameters.length == 1) {
    let jsDoc = synthesizeParameterJSDoc(method.methodParameters[0]);

    let jsonValue:any = typeToJSON(method.methodParameters[0].type,jsDoc,options);

    if(jsonValue) {
      let augmentedOptions = { expandRefs:true };

      for(let key in options) {
        if(key != "expandRefs") augmentedOptions = options[key];
      }

      jsonValue = typeToJSON(method.methodParameters[0].type,jsDoc,augmentedOptions);

      if(jsonValue.type == "object") {
        for(let p in jsonValue.properties) {
          props[p] = jsonValue.properties[p];
          parameterNames.push(p);
        }
        required = jsonValue.required;
        passthrough = true;
      }
      else {
        let parameterName = method.methodParameters[0].id;

        props[parameterName] = jsonValue;
        parameterNames.push(parameterName);
        if(parameterName) required.push(parameterName);
      }
    }
  }
  else {
    for(let i = 0;i < method.methodParameters.length;i++) {
      let jsDoc = synthesizeParameterJSDoc(method.methodParameters[i]);
      let jsonValue = typeToJSON(method.methodParameters[i].type,jsDoc,options);

      if(jsonValue) props[method.methodParameters[i].id] = jsonValue;
    }
    for(let i = 0;i < method.methodParameters.length;i++) {
      let parameterName = method.methodParameters[i].id;

      parameterNames.push(parameterName);
      if(method.methodParameters[i].required) required.push(parameterName);
    }
  }

  let res:any = {
    classRef: `${method.classRef}`,
    method: `${method.name}`,
    parameterNames: parameterNames,
    passthrough:passthrough,
    schema: {
      title: `${method.name} plist`,
      description: `Parameter list for ${method.name}`,
      type: "object",
      properties: props
    }
  };

  if(required != null && required.length > 0) res.required = required;
  return res;
}

/**
 * This function loops over the parameter list of a method and returns an array of
 * parameter describing interface objects.
 *
 * @param {any} parms The AST subtree describing the parameter list.
 */
export function traverseParameterList(parms: any,decoratorMeta:any): TypedId[] {
  let parameterList:TypedId[] = [];

  for(let i = 0;i < parms.length;i++) {
    let required = true;

    if(parms[i].questionToken != null) required = false;
    parameterList.push(<TypedId>{ id:parms[i].name.text, type:parms[i].type, decorators:decoratorMeta[parms[i].name.text], required:required });
  }
  return parameterList;
}

/**
 * This function is called after the first pass of the AST is completed.  It augments
 * the classes found in the global symbol table that was constructed in part in pass 1
 * and annotated by @controller with the methods that belong to that class.
 *
 * @param {DecoratedFunction[]} endpoints an array of all of the relevant annotated
 * methods.
 */
export function connectMethods(endpoints:DecoratedFunction[]): void {
  for(let i = 0;i < endpoints.length;i++) {
    if(endpoints[i].index != null) {
      let controller:any = symtabGet(endpoints[i].index);
            
      if(controller != null) {
        if(controller.methods != null) controller.methods.push(endpoints[i]);
        else console.log(`Ignoring endpoint ${endpoints[i].name} of ${endpoints[i].classRef}`);
      }
    }
  }
}

function isMagic(typeDesc:any) {
  if(typeDesc == null) return false;

  let typeName = typeDesc.name.text;

  if(typeName == "Res" || typeName == "FileRef") return true;

  let isUnion = typeDesc.kind == ts.SyntaxKind.UnionType;

  if(!isUnion && typeDesc.kind == ts.SyntaxKind.TypeAliasDeclaration) {
    while(typeDesc.kind == ts.SyntaxKind.TypeAliasDeclaration) {
      let componentDesc = symtabGet(typeName);

      if(componentDesc == null) break;

      let alias = componentDesc.decl;

      if(alias.type != null) {
        typeDesc = alias.type;
        isUnion = alias.type.kind == ts.SyntaxKind.UnionType;
      }
      else break;
      if(isUnion) break;

      let typename = getIndex(typeDesc);

      if(isExplicitStatus(typename)) return true;
    }
  }

  if(!isUnion) return false;

  let unionDesc = <ts.UnionTypeNode>typeDesc;
  let isMultiStatus = false;

  for(let i = 0;i < unionDesc.types.length;i++) {
    let unionElementTypename = getIndex(unionDesc.types[i]);

    if(unionElementTypename != null && isExplicitStatus(unionElementTypename)) return true;
  }
  return false;
}

export function isExplicitStatus(index) {
  if(index == null) return false;
  if(typeof index == "string")  return index == "Res";
  else if(index.local == "Res" && index.module.match(/.*ts-api.*/)) return true;
  return false;
}

export function isFileReturn(index) {
  if(index == null) return false;
  if(typeof index == "string") return index == "FileRef";
  else if(index.local == "FileRef" && index.module.match(/.*ts-api.*/)) return true;
  return false;
}

/**
 * This function creates the JSON schema reference document that corresponds to
 * all marked (relevant) types defined in the global symbol table created from the 
 * traversal of the AST of the typescript sources.
 *
 */
export function symtabToSchemaDefinitions(schemaNamespace:string,docRoot:string,expandOptions?:any): Object {
  let res = {};

  for(let skey in symtab) {
    let sentry = symtab[skey];

    if(sentry.kind == "type" && sentry.relevant) {
      let required = [];
      let decl = sentry.decl;

      if(!isMagic(decl)) {
        let schemaRefId = sentry.schemaRefId;
        let allOf;
 
        if(decl.kind == ts.SyntaxKind.InterfaceDeclaration || decl.kind == ts.SyntaxKind.ClassDeclaration) {
          res[schemaRefId] = { type:"object", properties:{} };
          for(let mkey in sentry.members) {
            res[schemaRefId].properties[mkey] = sentry.members[mkey].desc[schemaNamespace];
            if(!sentry.members[mkey].optional) required.push(mkey);
          }
          if(sentry.inherits != null && sentry.inherits.length > 0) {
            allOf = [];
            for(let i = 0;i < sentry.inherits.length;i++) {
              let hindex = sentry.inherits[i];
              let hentry = symtabGet(hindex);

              allOf.push(mapTypeDescName(docRoot,hentry.schemaRefId));
            }
          } 
        }
        else if(decl.type != null) {
          let options = { schemaNamespace:schemaNamespace, docRoot:docRoot };

          for(let option in expandOptions) options[option] = expandOptions[option];
          res[schemaRefId] = typeToJSON(decl.type,sentry.jsDoc,{ enclosedBy:skey, options:options });
        }
        if(required.length > 0) res[schemaRefId].required = required;
        if(sentry.comment != null) res[schemaRefId].description = sentry.comment;
        if(sentry.schema == null) sentry.schema = {};
        if(allOf != null) {
          allOf.push(res[schemaRefId]);
          res[schemaRefId] = { allOf:allOf };
        }
        sentry.schema[schemaNamespace] = res[schemaRefId];
      }
    }
  }
  // Now traverse again, and this time look for the itypes, all the processing has been
  // done in the previous traversal, so just output the generated def.
  if(expandOptions != null && expandOptions.firstclassIntermediates) {
    for(let skey in symtab) {
      let sentry = symtab[skey];

      if(sentry.kind == "itype") {
        let esentry = symtabGet(sentry.enclosedBy);

        if(esentry != null && esentry.relevant) {
          let schemaRefId = sentry.schemaRefId;
          res[schemaRefId] = sentry.schema;
        }
      }
    }
  }
  return res;
}

/**
 * Detects a url param variable in a path, returns metadata of the path.
 * 
 * @param path {string} the path of a URL associated decorator (router,controller,method).
 */
export function decomposePath(path:string): PathDecomposition {
  let delimited = path.split('/');
  let urlParams = {}
  let pathComponents = [];

  for(let i = 0;i < delimited.length;i++) {
    if(delimited[i] != '') {
      if(delimited[i].match(/:.*/)) {
        let base = delimited[i].replace(/:/g,"")

        pathComponents.push(base);
        urlParams[base] = true;
      }
      else pathComponents.push(delimited[i]);
    }
  }
  return { pathComponents:pathComponents, urlParams:urlParams };
}

/**
 * Compiles the list of controller definitions by iterating over
 * the global pass 1 typescript source symbol table and creating a record
 * for each entry marked with type "controller".
 */
export function symtabToControllerDefinitions(): Controller[] {
  let res:Controller[] = [];

  for(let skey in symtab) {
    let sentry = symtab[skey];

    if(sentry.kind == "controller") {
      let classRef = sentry.schemaRefId;
      let path = classRef;
      let comment = sentry.comment;
      let fileName = sentry.fileName;

      if(sentry.args != null && sentry.args[0] != null) path = sentry.args[0];

      res.push({ 
        args:sentry.args,
        classRef:classRef,
        comment:comment,
        fileName:fileName,
        methods:sentry.methods,
        decomposition:decomposePath(path)
      });
    }
  }
  return res;
}

/**
 * Like above, compiles the list of router definitions by iterating over 
 * the global pass 1 typescript source symbol table and creating a record
 * for each entry marked with type "router".
 */
export function symtabToRouterDefinitions(): Router[] {
  let res:Router[] = [];

  for(let skey in symtab) {
    let sentry = symtab[skey];

    if(sentry.kind == "router") {
      let className = sentry.schemaRefId;
      let path = className;
      let comment = sentry.comment;
      let fileName = sentry.fileName;

      if(sentry.args != null && sentry.args[0] != null) path = sentry.args[0];
     
      let pathComponents = path.split('/');
      let urlParams:string[] = [];

      for(let i = 0;i < pathComponents.length;i++) {
        if(pathComponents[i].match(/:.*/)) urlParams.push(pathComponents[i].replace(/:/g,""));
      }
      res.push({
        args:sentry.args,
        className:className,
        comment:comment,
        fileName:fileName,
        decomposition:decomposePath(path)
      });
    }
  }
  return res;
}

export function isURLParam(id:string,router:Router,controller:Controller,methodPathDecomposition:PathDecomposition):boolean {
  return router.decomposition.urlParams[id] || controller.decomposition.urlParams[id] || methodPathDecomposition.urlParams[id];
}

/**
 * Generates the the function "argsToSchema" in __check.js.  This function
 * is generated 1 time for each relevant method, and so it not a single exported
 * function but rather a named member of a checking class contained by an 
 * enclosing object indexed by the classname of the class of which it is a member.
 * The purpose of this generated function when run is to create the input to the JSON
 * schema checker that corresponds to the parameters of that method.  It is used
 * by the verb decorator (see verb.ts).
 *
 *     let check = binding.check[(<any>target.constructor).name + "." + key];
 *     let valid = check.validate(check.argsToSchema(arguments));
 *
 * @param {any} parameterNames the list of paremter names.
 */
function genArgsToSchema(parameterNames: any,passthrough:boolean): string {
  let s = '';

  s += `function(a) {\n`;
  if(passthrough) s += `    let o = a[0];\n`;
  else {
    s += `    let o = {};\n\n`;
    for(let i = 0;i < parameterNames.length;i++) {
      s += `    o['${parameterNames[i]}'] = a[${i}];\n`;
    }
  }
  s += `    return o;\n  }`;
  return s;
}

/**
 * Generates the the function "schemaToArgs" in __check.js.  This function
 * (as above) is generated 1 time for each relevant method, and likewise is
 * meant to reverse the effect of the above method.  This is to allow ajv
 * transformation side effects in validate to propogate forwared so it's not
 * simply a metter of just using the original argument list.
 *
 * @param {any} parameterNames the list of paremter names.
 */
function genSchemaToArgs(parameterNames: any,passthrough:boolean): string {
  let s = '';

  s += `function(o) {\n`;
  if(passthrough) s += `    let a = [o];\n\n`;
  else {
    s += `    let a = [];\n\n`;
    for(let i = 0;i < parameterNames.length;i++) {
       s += `    a[${i}] = o['${parameterNames[i]}'];\n`;
    }
  }
  s += `    return a;\n  }`;
  return s;
}

/**
 * Generates a member of the check object for a method. Each entry contains a reference
 * JSON schema labeled 'schema', the function argsToSchema which creates the arguments
 * to the checker, and validate which is the validator.  Each entry in indexed by the
 * unique combination of className.methodName.
 *
 * @param className Name of the (controller) class.
 * @param methodName Name of the method.
 * @param parameterNames list of each formal parameter to the method.
 * @param schema the JSON schema of all of the relevant type definitions.
 */
export function genMethodEntry(classRef,methodName,parameterNames,schema,passthrough:boolean): string {
  let s = `\nexports["${classRef}.${methodName}"] = {\n`;

  if(schema.type == "object") {
    let numParameters = 0; 
    let child;
    let childName;

    for(let p in schema.properties) {
      child = schema.properties[p];
      childName = p;
      numParameters++;
    }
  }

  let schemaFormatted = JSON.stringify(schema,null,2);

  schemaFormatted = schemaFormatted.replace(/\n/g,"\n  ");
  s += `  schema:compositeWithDefinitions(${schemaFormatted}),\n`;
  s += `  argsToSchema:${genArgsToSchema(parameterNames,passthrough)},\n`;
  s += `  schemaToArgs:${genSchemaToArgs(parameterNames,passthrough)},\n`;
  s += `  validate:validate(${schemaFormatted})\n`;
  s += `};\n`;
  return s;
}

/**
 * Adds an entry for a controller to the global typescript source symbol table.
 *
 * @param {string} className the name of the class annotated by @controller.
 * @param {string} fileName the name of the file containing the controller definition.
 * @param {string} comment a JSDoc type comment of the controller.
 */
export function addController(index:any,fileName: string,comment: string): void {
  symtabPut(index,{ kind:"controller", fileName:fileName, comment:comment, methods:[], args:[] });
}

/**
 * Adds an entry for a router to the global typescript source symbol table.
 *
 * @param {string} className the name of the class annotated by @router.
 * @param {string} fileName the name of the file containing the router definition.
 * @param {string} comment a JSDoc type comment of the router.
 */
export function addRouter(index:any,fileName: string,comment: string): void {
  symtabPut(index,{ kind:"router", fileName:fileName, comment:comment, args:[] });
}

/**
 * Output a path of appropriate type-style by concetenating the components some of which
 * might also be urlParam type components.
 *
 * @param decomposition {PathDecomposition} The decomposed form of a path -- broken down into components.
 & @param pathType: Either swagger or express
 */
export function decompositionToPath(decomposition:PathDecomposition,pathType:"swagger"|"express"):string {
  let path = "";

  for(let i = 0;i < decomposition.pathComponents.length;i++) {
    let component = decomposition.pathComponents[i];

    if(path != "") path = path + '/';
    if(decomposition.urlParams[component]) {
      if(pathType == "swagger") path = path + '{' + component + '}';
      else path = path + ':' + component;
    }
    else path = path + component;
  }
  return path;
}
