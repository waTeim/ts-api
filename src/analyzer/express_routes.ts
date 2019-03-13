import * as ts from "typescript";
import * as path from "path";

const tsany = ts as any;

import { TypedId, PathDecomposition, DecoratedFunction, Controller, Router } from "./types";
import { typeToJSON } from "./symtab";
import { synthesizeParameterJSDoc, decomposePath, decompositionToPath, isURLParam } from "./traverse";

function genAssignment1(id:string,dataSource:string,kind:string,typeSpec:any,content:string) {
  let output = "";
  let type = typeSpec.type;

  if(content != "flat" && (type == "object" || type == null || type == "array")) {
    if(type == "array") {
      if(typeSpec.items.type == "object" || typeSpec.items['$ref'] != null) {
        output = `      let ${id};\n`;
      }
      else {
        if(kind == "urlParam")
          output = `      let ${id} = req.params.${id};\n`;
        else
          output = `      let ${id} = req.${dataSource}.${id};\n`;
      }
    }
    else {
      output = `      let ${id};\n`;
    }
  }
  else {
    if(kind == "urlParam")
      output = `      let ${id} = req.params.${id};\n`;
    else
      output = `      let ${id} = req.${dataSource}.${id};\n`;
  }
  return output;
}

function genAssignment2(id:string,dataSource:string,kind:string,typeSpec:any,content:string) {
  let output = "";
  let type = typeSpec.type;

  if(content != "flat" && (type == "object" || type == null || type == "array")) {
    if(type == "array") {
      if(typeSpec.items.type == "object" || typeSpec.items['$ref'] != null) {
        if(kind == "urlParam")
          output = `      try { ${id} = (typeof req.params.${id} == "string")?JSON.parse(req.params.${id}):req.params.${id}; } catch(e) {};\n`;
        else
          output =  `      try { ${id} = (typeof req.${dataSource}.${id} == "string")?JSON.parse(req.${dataSource}.${id}):req.${dataSource}.${id}; } catch(e) {};\n`;
      }
    }
    else {
      if(kind == "urlParam")
        output = `      try { ${id} = (typeof req.params.${id} == "string")?JSON.parse(req.params.${id}):req.params.${id}; } catch(e) {};\n`;
      else
        output =  `      try { ${id} = (typeof req.${dataSource}.${id} == "string")?JSON.parse(req.${dataSource}.${id}):req.${dataSource}.${id}; } catch(e) {};\n`;
    }
  }
  return output;
}

function genAssignment3(id:string,dataSource:string,kind:string,typeSpec:any,content:string) {
  let output = "";
  let type = typeSpec.type;

  if(type == "array") {
    output += `      if(${id} != null) {\n`;
    output += `        if(!Array.isArray(${id})) ${id} = [${id}];\n`;
    output += `      }\n`;
  }
  return output;
}

function genControllerArgAssignmentsA(dataSource:string,params:any[],endpointName:string,genFunc:Function): string {
  let output = "";

  for(let i = 0;i < params.length;i++)
    output += genFunc(params[i].id,dataSource,params[i].kind,params[i].type,params[i].type.content);
  return output;
}

function genControllerArgAssignmentsB(dataSource:string,params:any[],endpointName:string,genFunc:Function,argListFormal:Array<any>): string {
  let output = "";

  for(let i = 0;i < params.length;i++) {
    if(params[i].kind == "urlParam") {
      output += genFunc(params[i].id,dataSource,params[i].kind,params[i].type,params[i].type.content);
      if(argListFormal != null) argListFormal.push(params[i].id);
    }
    else {
      if(params[i].type.type == "object") {
        let properties = params[i].type.properties;
        let objArgs = [];

        for(let propertyName in properties) {
          output += genFunc(propertyName,dataSource,"regular",properties[propertyName],properties[propertyName].content);
          objArgs.push(propertyName);
        }
        if(argListFormal != null) argListFormal.push(objArgs);
      }
      else {
        output += genFunc(params[i].id,dataSource,params[i].kind,params[i].type,params[i].type.content);
        if(argListFormal != null) argListFormal.push(params[i].id);
      }
    }
  }
  return output;
}

function genControllerArgListA(dataSource:string,params:any[],endpointName:string): string {
  let output = "";
  let assignments1 = genControllerArgAssignmentsA(dataSource,params,endpointName,genAssignment1);
  let assignments2 = genControllerArgAssignmentsA(dataSource,params,endpointName,genAssignment2);
  let assignments3 = genControllerArgAssignmentsA(dataSource,params,endpointName,genAssignment3);

  if(assignments1 != "") output += `${assignments1}`;
  if(assignments2 != "") output += `\n${assignments2}\n`;
  if(assignments3 != "") output += `\n${assignments3}\n`;
  output += `      const __res = await controller.${endpointName}(`;
  for(let i = 0;i < params.length;i++) {
    if(i != 0) output += ',';
    output += `${params[i].id}`;
  }
  output += `);\n\n`;
  return output;
}

function genControllerArgListB(dataSource:string,params:any[],endpointName:string): string {
  let output = "";
  let argListFormal = [];
  let assignments1 = genControllerArgAssignmentsB(dataSource,params,endpointName,genAssignment1,argListFormal);
  let assignments2 = genControllerArgAssignmentsB(dataSource,params,endpointName,genAssignment2,null);
  let assignments3 = genControllerArgAssignmentsB(dataSource,params,endpointName,genAssignment3,null);
  let anum;

  if(assignments1 != "") output += `${assignments1}`;
  if(assignments2 != "") output += `\n${assignments2}\n`;
  if(assignments3 != "") output += `\n${assignments3}\n`;
  for(let i = 0;i < argListFormal.length;i++) {
    if(typeof argListFormal[i] != "string") {
      if(anum == null) anum = 0;
      output += `      let __arg${anum++} = {};\n`;
    }
  }
  if(anum != null) {
    anum = 0;

    for(let i = 0;i < argListFormal.length;i++) {
      if(typeof argListFormal[i] != "string") {
        for(let j = 0;j < argListFormal[i].length;j++) {
          output += `      if(${argListFormal[i][j]} != null) __arg${anum}.${argListFormal[i][j]} = ${argListFormal[i][j]};\n`;
        }
        anum++;
      }
    }
  }
  if(anum != null) anum = 0;
  output += `      const __res = await controller.${endpointName}(`;
  for(let i = 0;i < argListFormal.length;i++) {
    if(i != 0) output += ',';
    if(typeof argListFormal[i] == "string") output += `${argListFormal[i]}`;
    else output += `__arg${anum++}`;
  }
  output += `);\n\n`;
  return output;
}

/**
 * Generate the express routes fron the router, controller, and method declarations.  Make
 * use of the fact that the generated file '__check.js' will always be located in the same
 * directory as the routes file '__routes.js'.  Make use of supporting files from this package
 * to create instances of the controller classes.  The form of this file when used as a target
 * to require is to export a single function that takes a single argument of type RouterBase
 * (which the class annotated with @router should derive from), and when invoked will create
 * all of the controllers, and add them to the the router, and then connect the controllers
 * to express app; it is assumed that the router class will have a reference to app at the time,
 * but it should since this is a required parameter to RouterBase constructor.  Generate
 * a app.{get,post,put,...} for each method of a controller an analogous annotation.
 *
 * @param {DecoratedFunction[]} endpoints A array of all of the methods decorated with REST verbs.
 * @param {Router} top level router class.
 * @param {Controller[]} controllers array of method controllers
 * @param {NodeJS.ReadWriteStream} routesFile reference to the routes output file.
 */
export function genExpressRoutes(endpoints:DecoratedFunction[],router:Router,controllers:Controller[],srcRoot: string,routesFile: NodeJS.ReadWriteStream):string {
  let output = `"use strict";\n\n`;
  let resolvedRoot;
  let controllerIndex = {};

  if(srcRoot != null) resolvedRoot = path.resolve(srcRoot);

  output += `const express = require('express');\n`;
  output += `const api = require('ts-api');\n`;
  output += `const EndpointCheckBinding = api.EndpointCheckBinding;\n`;
  output += `const ControllerProperties = api.ControllerProperties;\n`;
  output += `const error_response = api.response.error;\n`;
  output += `const success_response = api.response.success;\n`;

  // Generate requires for controller classes.  Use parser support for
  // the file they are defined in to provide the parameter for require.
  for(let i = 0;i < controllers.length;i++) {
    let fileName = path.resolve(controllers[i].fileName);

    if(srcRoot != null) {
      fileName = fileName.replace(resolvedRoot + '/','');
      fileName = fileName.replace(path.extname(fileName),"");
      output += `const ${controllers[i].classRef}Module = require('./${fileName}');\n`;
    }
    else output += `const ${controllers[i].classRef}Module = require('./${path.basename(fileName)}');\n`;
    controllerIndex[controllers[i].classRef] = controllers[i];
  }

  // include support for automatic swagger document display endpoint.  Avoid
  // requiring that package directory by proxying the require through ts-api.
  // make use of the guaranteed location of the swagger doc that is generated
  // relative to the routes file.
  output += `const swaggerUi = api.swaggerUi;\n`;
  output += `const swaggerDocument = require('./docs/swagger.json');\n`;
  output += `\nlet binding = new EndpointCheckBinding(require('./__check'));\n`;
  output += `\nmodule.exports = function(root) {\n`;

  let routerPath = decompositionToPath(router.decomposition,"express");

  for(let i = 0;i < controllers.length;i++) {
    let path = '/' + decompositionToPath(controllers[i].decomposition,"express");

    if(routerPath != "") path = `/${routerPath}${path}`;
    output += `  root.addRouter('${path}','${controllers[i].classRef}',{ mergeParams:true });\n`;
  }

  for(let i = 0;i < endpoints.length;i++) {
    let rfunc = endpoints[i].type;
    let endpointName = endpoints[i].name;
    let path = endpointName;
    let dataSource = "query";
  
    if(endpoints[i].decoratorArgs.length != 0) path = endpoints[i].decoratorArgs[0];

    let endpointPathDecomposition = decomposePath(path);
    let endpointPath = decompositionToPath(endpointPathDecomposition,"express");

    // For each method, tie everything together by creating the right controller instance,
    // collecting the express REST parameters, converting it to the method parameters, and then
    // invoking the method with those parameters.  Assume coordiation with the 
    // express verb decorator defined in this package.
    output += `\n`;
    output += `  root.getExpressRouter('${endpoints[i].classRef}').${rfunc}('/${endpointPath}', async(req,res,next) => {\n`;
    output += `    try {\n`;
    if(rfunc != 'get') {
      output += `      if(req.body == null) throw("body is null (possible missing body parser)")\n`;
      dataSource = "body";
    }
    output += `      const properties = new ControllerProperties(binding,root.context,req,res,next);\n`
    output += `      const controller = new ${endpoints[i].classRef}Module.default(properties);\n`
  
    let params = [];
    let numURLParam = 0;

    // Gather parameter metadata prior to output
    for(let j = 0;j < endpoints[i].methodParameters.length;j++) {
      let parm = endpoints[i].methodParameters[j];
      let jsDoc = synthesizeParameterJSDoc(endpoints[i].methodParameters[j]);
      let parmType = typeToJSON(parm.type,jsDoc,{ expandRefs:true, firstclassIntermediates:true, schemaNamespace:"swagger", docRoot:"#/definitions" })

      if(parm.decorators != null) {
        let isURLDecorated = false;

        for(let decoratorName in parm.decorators) {
          if(decoratorName == 'urlParam') {
            let decoratorArgs = parm.decorators[decoratorName];

            if(decoratorArgs.length) params.push({ id:decoratorArgs[0], kind:"urlParam" });
            else params.push({ id:parm.id, kind: "urlParam", type:parmType });
            numURLParam += 1;
          }
        }
        if(!isURLDecorated) {
          if(isURLParam(parm.id,router,controllerIndex[endpoints[i].classRef],endpointPathDecomposition)) {
            params.push({ id:parm.id, kind: "urlParam", type:parmType });
            numURLParam += 1;
          }
          else params.push({ id:parm.id, kind: "regular", type:parmType });
        }
      }
      else if(isURLParam(parm.id,router,controllerIndex[endpoints[i].classRef],endpointPathDecomposition)) {
        params.push({ id:parm.id, kind: "urlParam", type:parmType });
        numURLParam += 1;
      }
      else
        params.push({ id:parm.id, kind: "regular", type:parmType });
    }
    if(params.length - numURLParam > 1) output += genControllerArgListA(dataSource,params,endpointName);
    else output += genControllerArgListB(dataSource,params,endpointName);
    output += `      success_response(__res,req,res,next);\n`;
    output += `    }\n`;
    output += `    catch(e) { error_response(e,req,res,next); }\n`;
    output += `  });\n`;
  }

  let docPath = '/docs';
  let redocPath = '/redoc';
  let staticPath = '/doc-static';
  let swaggerPath = '/doc-static/swagger.json';

  if(routerPath != "") {
    docPath = `/${routerPath}${docPath}`;
    redocPath = `/${routerPath}${redocPath}`;
    staticPath = `/${routerPath}${staticPath}`;
    swaggerPath = `/${routerPath}${swaggerPath}`;
  }
  output += `  root.getExpressRouter().use('${docPath}',swaggerUi.serve,swaggerUi.setup(swaggerDocument));\n`;
  output += `  root.getExpressRouter().get('${redocPath}',function(req,res,next) {\n `;
  output += `    res.sendFile(__dirname + '/docs/redoc.html');\n`;
  output += `  });\n`;
  output += `  root.getExpressRouter().use('${staticPath}',express.static(__dirname + '/docs'));\n`;
  output += `  return root.getExpressRouter();\n`;
  output += `}\n`;

  routesFile.write(output);
  return swaggerPath;
}
