import * as ts from "typescript";

const tsany = ts as any;

import { TypedId, PathDecomposition, DecoratedFunction, Controller, Router } from "./types";
import { checker, getIndex, symtabGet, symtabPut, typeToJSON } from "./symtab";
import { synthesizeParameterJSDoc, isExplicitStatus, decomposePath, decompositionToPath, isURLParam } from "./traverse";

/**
 * Create the hardcoded first part of a swagger doc.  Global documentation derived from the
 * block comments of the controller classes as well as the class annotated with @router is set here.
 *
 * @param {any} def reference to the swagger doc.
 * @param {string} projectName the name of the project (is derived from package.json packageName).
 * @param {Router} router definition.
 * @param {Controller[]} array of controller definitions.
 */
export function genSwaggerPreamble(def: any,projectName:string,router:Router,controllers:Controller[]): void {
  let comments = "";

  if(router.comment != null && router.comment != '') comments += router.comment + "\n\n";
  def.openapi = "3.0.0";
  def.info = { version:"1.0.0", title:projectName };
  if(comments.length != 0) def.info.description = comments;
}

/**
 * Generate swagger tags based on controller paths 
 *
 * @param {any} def reference to the swagger doc.
 * @param {Router} router definition.
 * @param {Controller[]} array of controller definitions.
 */
export function genSwaggerRootTags(def: any,router:Router,controllers:Controller[]): void {
  let tags = [];

  for(let i = 0;i < controllers.length;i++) {
    let tag = controllers[i].classRef;

    if(controllers[i].comment != null && controllers[i].comment != '')
      tags.push({ name:tag, description:controllers[i].comment });
  }
  def.tags = tags;
}

function genSwaggerPathParameters(router:Router,controller:Controller,method:DecoratedFunction,methodPathDecomposition:PathDecomposition) {
  let parameters = [];

  for(let i = 0;i < method.methodParameters.length;i++) {
    let parameter = method.methodParameters[i];
    let jsDoc = synthesizeParameterJSDoc(method.methodParameters[i]);
    let parameterTypedef:any = typeToJSON(parameter.type,jsDoc,{ expandRefs:true, schemaNamespace:"swagger", docRoot:"#/components/schemas" });

    if(parameterTypedef != null && parameterTypedef.type == "object") {
      for(let pname in parameterTypedef.properties) {
        if(isURLParam(pname,router,controller,methodPathDecomposition))
          parameters.push({ name:pname, in:"path", schema:parameterTypedef.properties[pname], required:true });
      }
    }
    else {
      if(isURLParam(parameter.id,router,controller,methodPathDecomposition))
        parameters.push({ name:parameter.id, in:"path", schema:parameterTypedef, required:true  });
    }
  }
  return parameters;
}

function genSwaggerRequestParameters(router:Router,controller:Controller,method:DecoratedFunction,methodPathDecomposition:PathDecomposition) {
  let parameters = [];

  // Create the input doc swagger definition given the method parameters.  Recursively expand
  // objects rather that using JSON schema $ref, and if a method parameter is of type object, then
  // assume it's a class or interance and instead generate a swagger doc that is the members of
  // that aggregate.
  for(let i = 0;i < method.methodParameters.length;i++) {
    let parameter = method.methodParameters[i];
    let jsDoc = synthesizeParameterJSDoc(method.methodParameters[i]);
    let parameterTypedef:any = typeToJSON(parameter.type,jsDoc,{ expandRefs:true, docRoot:"#/components/schemas" });

    if(parameterTypedef != null && parameterTypedef.type == "object") {
      for(let pname in parameterTypedef.properties) {
        let isRequired = false;

        if(!isURLParam(pname,router,controller,methodPathDecomposition)) {
          if(parameterTypedef.required != null) {
            for(let l = 0;l < parameterTypedef.required.length;l++) {
              if(parameterTypedef.required[l] == pname) isRequired = true;
            }
          }
          parameters.push({ name:pname, in:"query", schema:parameterTypedef.properties[pname], required:isRequired });
        }
      }
    }
    else if(!isURLParam(parameter.id,router,controller,methodPathDecomposition))
      parameters.push({ name:parameter.id, in:"query", schema:parameterTypedef, required:parameterTypedef.required });
  }
  return parameters;
}

function genSwaggerRequestBody(synthesizedTypes:any,router:Router,controller:Controller,method:DecoratedFunction,methodPathDecomposition:PathDecomposition) {
  let parameters = [];
  let parametersEx = [];

  for(let i = 0;i < method.methodParameters.length;i++) {
    let parameter = method.methodParameters[i];
    let jsDoc = synthesizeParameterJSDoc(method.methodParameters[i]);
    let parameterTypedef:any = typeToJSON(parameter.type,jsDoc,{ schemaNamespace:"swagger", firstclassIntermediates:true, docRoot:"#/components/schemas" });
    let parameterTypedefEx:any = typeToJSON(parameter.type,jsDoc,{ expandRefs:true, schemaNamespace:"swagger", docRoot:"#/components/schemas" });

    if(!isURLParam(parameter.id,router,controller,methodPathDecomposition)) {
      parameters.push({ name:parameter.id, required:parameterTypedef.required, schema:parameterTypedef });
      parametersEx.push({ name:parameter.id, required:parameterTypedefEx.required, schema:parameterTypedefEx });
    }
  }
  if(parameters.length == 1) {
    let jsonContent = { schema:parameters[0].schema };
    let formContent = { schema:parametersEx[0].schema };
    let encoding = {};
    let encodingPopulated = false;

    for(let property in parametersEx[0].schema.properties) {
      if(parametersEx[0].schema.content != "flat" && (parametersEx[0].schema.properties[property].type == "object" || parametersEx[0].schema.properties[property] == null)) {
        encoding[property] = { contentType:"application/json" };
        encodingPopulated = true;
      }
    }
    if(encodingPopulated) formContent["encoding"] = encoding;
    return { 
      required:parameters[0].required, 
      content:{ 
        "application/json":jsonContent,
        "application/x-www-form-urlencoded":formContent
      }
    };
  }
  else if(parameters.length > 1) {
    let methodName = method.name;
    let rqbName = `${controller.classRef}${methodName.substring(0,1).toUpperCase()}${methodName.substring(1)}Body`;
    let properties = {};
    let required = [];
    let notAllOptional = false;
    let inline = { type:"object", properties:properties, required:required };
    let encoding = {};
    let encodingPopulated = false;

    for(let i = 0;i < parameters.length;i++) {
      properties[parameters[i].name] = parameters[i].schema;
      if(parameters[i].schema.content != "flat" && (parameters[i].schema.type == "object" || parameters[i].schema.type == null)) {
        encoding[parameters[i].name] = { contentType:"application/json" };
        encodingPopulated = true;
      }
      if(parameters[i].required) {
        required.push(parameters[i].name);
        notAllOptional = true;
      }
    }

    let jsonContent = { schema:{ "$ref":`#/components/schemas/${rqbName}` }};
    let formContent = { schema:inline };

    if(encodingPopulated) formContent["encoding"] = encoding;
    synthesizedTypes[rqbName] = { type:"object", properties:properties, required:required, description:`synthesized request body type for ${controller.classRef}.${methodName}` };
    return { 
      required:notAllOptional,
      content:{ 
        "application/json":jsonContent,
        "application/x-www-form-urlencoded":formContent
      }
    };
  }
  else return { content:{} };
}
function returnAtom(typeDesc:any) {
  let index = getIndex(typeDesc);
  let contentType = "application/json";
  let res = {};
  let schema;

  if(index != null && index.local == "FileRef") {
    let args = (<any>typeDesc).typeArguments;

    if(args != null) {
      contentType = tsany.getTextOfNode(args[0]);
      contentType = contentType.replace(/^"(.*)"$/, '$1');
    }
    else contentType = "application/octet-stream";
    schema = { type:"string", format:"binary" };
  }
  else {
    schema = typeToJSON(typeDesc,null,{ expandRefs:true, schemaNamespace:"swagger", docRoot:"#/components/schemas" });
  }

  res[contentType] = { schema:schema };
  return res;
}


function explicitStatus(returnTypeDesc:any) {
  let res = {};
 
  let statusCodeDesc = (<any>returnTypeDesc).typeArguments[0];
  let statusCode = checker.getTypeFromTypeNode(statusCodeDesc).value;
  let resReturnType = (<any>returnTypeDesc).typeArguments[1];
  let content = returnAtom(resReturnType);

  if(content != null) res[statusCode] = { description:"Successful response", content:content };
  else res["204"] = { description:"Successful response" };
  return res;
}

function returnMerge(resN:any,resX:any) {
  for(let statusCode in resN) {
    if(resX[statusCode] == null) resX[statusCode] = resN[statusCode];
    else {
      for(let contentType in resN[statusCode].content) {

        if(resX[statusCode].content[contentType] == null) resX[statusCode].content[contentType] = resN[statusCode].content[contentType];
        else if(contentType == "application/json") {
          if(resX[statusCode].content[contentType].oneOf == null) {
            let tmp = resX[statusCode].content[contentType];

            resX[statusCode].content[contentType] = { oneOf:[] };
            resX[statusCode].content.oneOf.push(tmp);
          }
          resX[statusCode].content.oneOf.push(resN);
        }
        else throw("unable to combine non-hierarchial content types with oneOf");
      }
    }
  }
}

function genSwaggerReturn(returnTypeDesc:any,res:any) {
  if(returnTypeDesc == null) return null;

  let returnTypename = getIndex(returnTypeDesc);

  // If the method return type is a promise infer that this is an async function and
  // instead use the subordinate type as the type defined by the swagger doc.
  if(returnTypename == "Promise") {
    let promiseArg = (<any>returnTypeDesc).typeArguments[0];

    genSwaggerReturn(promiseArg,res);
  }
  else {
    if(isExplicitStatus(returnTypename)) {
      let resX:any = explicitStatus(returnTypeDesc);

      for(let statusCode in resX) res[statusCode] = resX[statusCode];
    }
    else {
      let isUnion = returnTypeDesc.kind == ts.SyntaxKind.UnionType;

      if(!isUnion && returnTypeDesc.kind == ts.SyntaxKind.TypeReference) {
        let alias = symtabGet(returnTypename).decl;

        if(alias.type) {
          isUnion = alias.type.kind == ts.SyntaxKind.UnionType;
          if(isUnion) returnTypeDesc = alias.type;
        }
      }

      if(isUnion) {
        let unionDesc = <ts.UnionTypeNode>returnTypeDesc;
        let resX = {};
        let isMultiStatus = false;

        for(let i = 0;i < unionDesc.types.length;i++) {
          let unionElementTypename = getIndex(unionDesc.types[i]);

          if(unionElementTypename != null) {
            if(!isExplicitStatus(unionElementTypename)) {
              let swaggerDef = returnAtom(unionDesc.types[i]);

              if(swaggerDef != null) {
                let resY = {};

                resY["200"] = swaggerDef;
                returnMerge(resY,resX);
              }
            }
            else {
              let resY = explicitStatus(unionDesc.types[i]);

              returnMerge(resY,resX);
            }
          }
          else {
            let swaggerDef = returnAtom(unionDesc.types[i]);

            if(swaggerDef != null) {
              let resY = {};

              resY["200"] = swaggerDef;
              returnMerge(resY,resX);
            }
          }
        }
        for(let statusCode in resX) res[statusCode] = resX[statusCode];
      }
      else {
        let content = returnAtom(returnTypeDesc);

        if(content != null)
          res["200"] = { description:"Successful response", content:content };
        else res["204"] = { description:"Successful response" };
      }
    }
  }
}


/**
 * Generate swagger paths (REST endpoints) given the combination of prefix, controller
 * paths and methods of those controllers.
 *
 * @param {any} def reference to the swagger doc.
 * @param {string} prefix top level path to pre-pend to all paths.
 * @param {Controller[]} array of controller definitions.
 */
function genSwaggerPaths(def:any,synthesizedTypes:any,router:Router,controllers:Controller[]): void {
  let paths:Object = {};
  let p1 = decompositionToPath(router.decomposition,"swagger");

  for(let i = 0;i < controllers.length;i++) {
    let methods: DecoratedFunction[] = controllers[i].methods;
    let p2 = decompositionToPath(controllers[i].decomposition,"swagger");
    let comment = controllers[i].comment;
    let tag = controllers[i].classRef;
    
    // For each controller, iterate over every method and create a path
    // for it.  If the method verb decorator contains a path use it, otherwise
    // use the name of the method itself.
    for(let j = 0;j < methods.length;j++) {
      let methodPath = methods[j].name;

      let parameters = [];
      let methodType = methods[j].type;
      let responses = {};
      let methodComment = methods[j].comment;

      if(methods[j].decoratorArgs.length != 0) methodPath = methods[j].decoratorArgs[0];

      let methodPathDecomposition = decomposePath(methodPath);
      let p3 = decompositionToPath(methodPathDecomposition,"swagger");

      // operationId is a unique identifier (across entire doc) for an operation
      let operationId = tag + '-' + methods[j].name;

      let path:any = { tags:[tag], operationId: operationId, responses:responses };
      let pathId = '/' + p2 + '/' + p3;
      let pathParameters = genSwaggerPathParameters(router,controllers[i],methods[j],methodPathDecomposition);

      if(methodComment != null && methodComment != "") path.description = methodComment;
      genSwaggerReturn(methods[j].returnType,responses);
      if(methodType == "post" || methodType == "all" || methodType == "put" || methodType == "patch") {
        if(pathParameters.length != 0) path.parameters = pathParameters;
        path.requestBody = genSwaggerRequestBody(synthesizedTypes,router,controllers[i],methods[j],methodPathDecomposition);
      }
      else path.parameters = pathParameters.concat(genSwaggerRequestParameters(router,controllers[i],methods[j],methodPathDecomposition));
      if(p1 != "") pathId = '/' + p1 + pathId;
      if(paths[pathId] == null) paths[pathId] = {};
      paths[pathId][methodType] = path;
    }
  }
  def.paths = paths;
}

/**
 * Generate all paths belonging to a router.  The expectation is that currently there will
 * only be a singleton router.
 *
 * @param {any} def reference to the swagger doc.
 * @param {Router} router definition.
 * @param {Controller[]} array of controller definitions.
 */
export function genSwaggerRoutes(def:any,synthesizedTypes:any,router:Router,controllers:Controller[]): void {
  let prefix = decompositionToPath(router.decomposition,"swagger");

  genSwaggerPaths(def,synthesizedTypes,router,controllers);
}
