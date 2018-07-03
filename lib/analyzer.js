"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var ts = require("typescript");
var glob = require("glob");
var doctrine = require("doctrine");
var path = require("path");
var tsany = ts;
;
;
var symtab = {};
var checker;
function tokenObjectToJSON(o, jsDoc) {
    var res = null;
    var unknown = false;
    switch (o.kind) {
        case ts.SyntaxKind.StringKeyword:
            {
                res = { type: "string" };
            }
            break;
        case ts.SyntaxKind.NumberKeyword:
            {
                res = { type: "number" };
            }
            break;
        case ts.SyntaxKind.BooleanKeyword:
            res = { type: "boolean" };
            break;
        case ts.SyntaxKind.AnyKeyword:
            res = { type: "object" };
            break;
        case ts.SyntaxKind.NullKeyword:
            res = { type: "null" };
            break;
        case ts.SyntaxKind.UndefinedKeyword: break;
        case ts.SyntaxKind.SymbolKeyword: break;
        case ts.SyntaxKind.FunctionType: break;
        default:
            unknown = true;
            break;
    }
    if (unknown)
        throw ("unknown type  (" + o.kind + ") in parameterlist");
    else
        return res;
}
function maptypeDescName(docRoot, name) {
    if (name == "Object")
        return { type: "object" };
    if (name == "String")
        return { type: "string" };
    if (name == "Number")
        return { type: "number" };
    if (name == "Boolean")
        return { type: "boolean" };
    if (name == "Function")
        return null;
    return { "$ref": docRoot + "/" + name };
}
function unionToJSON(typeDesc, jsDoc, options) {
    var unionDesc = typeDesc;
    var res = { oneOf: [] };
    for (var i = 0; i < unionDesc.types.length; i++) {
        var unionElement = typeToJSON(unionDesc.types[i], null, options);
        if (unionElement != null)
            res.oneOf.push(unionElement);
    }
    return res;
}
function literalToJSON(typeDesc, jsDoc) {
    var type = checker.getTypeFromTypeNode(typeDesc);
    if (type.value != null) {
        return { type: (typeof type.value), oneOf: [{ format: type.value }] };
    }
    var literal = checker.typeToString(type);
    throw ("unknown literal type (" + literal + ")");
}
function applyValueTag(schemaObject, title, value) {
    if (schemaObject.type != null && schemaObject.type != "null")
        schemaObject[title] = value;
    else if (schemaObject.oneOf != null) {
        for (var i = 0; i < schemaObject.oneOf.length; i++) {
            if (schemaObject.oneOf[i].type != null && schemaObject.oneOf[i].type != "null")
                schemaObject.oneOf[i][title] = value;
        }
    }
}
function applyTypenameTag(schemaObject, name) {
    if (schemaObject.type != null && schemaObject.type != "null")
        schemaObject.type = name;
    else if (schemaObject.oneOf != null) {
        for (var i = 0; i < schemaObject.oneOf.length; i++) {
            if (schemaObject.oneOf[i].type != null && schemaObject.oneOf[i].type != "null")
                schemaObject.oneOf[i].type = name;
        }
    }
}
function applyTag(schemaObject, tag) {
    if (tag == null)
        return;
    if (tag.title == "minimum" || tag.title == "maximum")
        applyValueTag(schemaObject, tag.title, parseInt(tag.description));
    else if (tag.title == "type") {
        if (tag.type.type == "NameExpression")
            applyTypenameTag(schemaObject, tag.type.name);
    }
}
function typeToJSON(typeDesc, jsDoc, options) {
    var res;
    if (typeDesc.constructor.name == 'NodeObject') {
        var unknown = false;
        var docRoot = "#/definitions";
        if (options != null && options.docRoot != null)
            docRoot = options.docRoot;
        switch (typeDesc.kind) {
            case ts.SyntaxKind.ArrayType:
                res = { type: "array", items: typeToJSON(typeDesc.elementType, jsDoc, options) };
                break;
            case ts.SyntaxKind.TypeReference:
                {
                    res = maptypeDescName(docRoot, typeDesc.typeName.text);
                    if (res != null && res['$ref'] != null && options && options.expandRefs) {
                        if (symtab[typeDesc.typeName.text] == null)
                            throw ("undefined type " + typeDesc.typeName.text);
                        res = symtab[typeDesc.typeName.text].def;
                    }
                }
                break;
            case ts.SyntaxKind.FunctionType: break;
            case ts.SyntaxKind.TypeQuery:
                res = null;
                break;
            case ts.SyntaxKind.UnionType:
                res = unionToJSON(typeDesc, jsDoc);
                break;
            case ts.SyntaxKind.LiteralType:
                res = literalToJSON(typeDesc, jsDoc);
                break;
            case ts.SyntaxKind.ParenthesizedType: break;
            //case ts.SyntaxKind.TypeQuery: res = { type:"type query not implemented" }; break;
            //case ts.SyntaxKind.ParenthesizedType: res = { type:"parenthesized type not implemented" }; break;
            default:
                unknown = true;
                break;
        }
        if (unknown)
            throw ("unknown type (" + typeDesc.kind + ") in parameterlist");
    }
    else if (typeDesc.constructor.name == 'TokenObject')
        res = tokenObjectToJSON(typeDesc, jsDoc);
    else
        throw ("unknown type (" + typeDesc.constructor.name + ")");
    if (res) {
        var symbol = checker.getTypeFromTypeNode(typeDesc).symbol;
        if (jsDoc != null && jsDoc.length != 0) {
            for (var i = 0; i < jsDoc.length; i++) {
                if (jsDoc[i].tags != null && jsDoc[i].tags.length != 0) {
                    for (var j = 0; j < jsDoc[i].tags.length; j++)
                        applyTag(res, jsDoc[i].tags[j]);
                }
            }
        }
        if (symbol)
            res.description = ts.displayPartsToString(symbol.getDocumentationComment());
    }
    return res;
}
function markUnionAsRelevant(typeDesc, jsDoc, options) {
    var unionDesc = typeDesc;
    for (var i = 0; i < unionDesc.types.length; i++)
        markAsRelevant(unionDesc.types[i], null, options);
}
function markAsRelevant(typeDesc, jsDoc, options) {
    if (typeDesc.constructor.name == 'NodeObject') {
        switch (typeDesc.kind) {
            case ts.SyntaxKind.ArrayType:
                markAsRelevant(typeDesc.elementType, jsDoc, options);
                break;
            case ts.SyntaxKind.TypeReference:
                {
                    if (symtab[typeDesc.typeName.text] == null)
                        throw ("undefined type " + typeDesc.typeName.text);
                    symtab[typeDesc.typeName.text].relevant = true;
                }
                break;
            case ts.SyntaxKind.UnionType:
                markUnionAsRelevant(typeDesc, jsDoc);
                break;
            default: break;
        }
    }
    else if (typeDesc.constructor.name != 'TokenObject')
        throw ("unknown type (" + typeDesc.constructor.name + ")");
}
function parameterListToJSON(method, options) {
    var props = {};
    var parameterNames = [];
    for (var i = 0; i < method.methodParameters.length; i++) {
        var jsonValue = typeToJSON(method.methodParameters[i].type, null, options);
        ;
        if (jsonValue) {
            props[method.methodParameters[i].id] = jsonValue;
            markAsRelevant(method.methodParameters[i].type, null, options);
        }
    }
    for (var i = 0; i < method.methodParameters.length; i++)
        parameterNames[i] = method.methodParameters[i].id;
    return {
        className: "" + method.className,
        method: "" + method.decorates,
        parameterNames: parameterNames,
        schema: {
            //"$schema": "http://json-schema.org/draft-07/schema#",
            title: method.decorates + " plist",
            description: "Parameter list for " + method.decorates,
            type: "object",
            properties: props
        }
    };
}
function traverseParameterList(parms) {
    var parameterList = [];
    for (var i = 0; i < parms.length; i++) {
        parameterList.push({ id: parms[i].name.text, type: parms[i].type });
    }
    return parameterList;
}
function connectMethods(endpoints) {
    for (var i = 0; i < endpoints.length; i++) {
        if (endpoints[i].className != null) {
            var controller = symtab[endpoints[i].className];
            if (controller != null)
                controller.methods.push(endpoints[i]);
        }
    }
}
function symtabToSchemaDefinitions() {
    var res = {};
    for (var ikey in symtab) {
        if (symtab[ikey].type == "type" && symtab[ikey].relevant) {
            var required = [];
            res[ikey] = { type: "object", properties: {} };
            for (var mkey in symtab[ikey].members) {
                res[ikey].properties[mkey] = symtab[ikey].members[mkey].desc;
                if (!symtab[ikey].members[mkey].optional)
                    required.push(mkey);
            }
            if (required.length > 0)
                res[ikey].required = required;
            if (symtab[ikey].comment != null)
                res[ikey].description = symtab[ikey].comment;
            symtab[ikey].def = res[ikey];
        }
    }
    return res;
}
function symtabToControllerDefinitions() {
    var res = [];
    for (var ikey in symtab) {
        if (symtab[ikey].type == "controller") {
            var className = symtab[ikey].name;
            var path_1 = className;
            var comment = symtab[className].comment;
            var fileName = symtab[className].fileName;
            if (symtab[ikey].args != null && symtab[ikey].args[0] != null)
                path_1 = symtab[ikey].args[0];
            res.push({
                path: path_1,
                className: className,
                fileName: fileName,
                comment: comment,
                methods: symtab[ikey].methods,
                args: symtab[ikey].args
            });
        }
    }
    return res;
}
function genArgsToSchema(parameterNames) {
    var s = '';
    s += "function(a) {\n";
    s += "let o = {};\n";
    s += "console.log(a);\n";
    for (var i = 0; i < parameterNames.length; i++) {
        s += "    o['" + parameterNames[i] + "'] = a[" + i + "];\n";
    }
    s += "  console.log(o);\n";
    s += "  return o;\n  }\n";
    return s;
}
function genMethodEntry(className, methodName, parameterNames, schema) {
    return "\nexports[\"" + className + "." + methodName + "\"] = { \n  schema:compositeWithDefinitions(" + JSON.stringify(schema, null, 2) + "),\n  argsToSchema:" + genArgsToSchema(parameterNames) + ",\n  validate:ajv.compile(compositeWithDefinitions(" + JSON.stringify(schema, null, 2) + "))\n};";
}
function addController(className, fileName, comment) {
    if (symtab[className] != null)
        throw ("multiple references to same class: " + className);
    symtab[className] = { type: "controller", name: className, fileName: fileName, comment: comment, methods: [], args: [] };
}
function genSwaggerPreamble(def, projectName, controllers) {
    var controllerComments = "";
    for (var i = 0; i < controllers.length; i++) {
        if (controllers[i].comment != null && controllers[i].comment != '') {
            if (controllerComments.length != 0)
                controllerComments += "\n\n";
            controllerComments += controllers[i].path + "\n\n";
            controllerComments += controllers[i].comment;
        }
    }
    def.openapi = "3.0.0";
    def.info = { version: "1.0.0", title: projectName };
    if (controllerComments.length != 0)
        def.info.description = controllerComments;
}
function genSwaggerTags(def, controllers) {
    var tags = [];
    for (var i = 0; i < controllers.length; i++) {
        tags.push({ path: controllers[i].path });
    }
    //def.tags = tags;
}
function genSwaggerPaths(def, controllers) {
    var paths = {};
    for (var i = 0; i < controllers.length; i++) {
        var methods = controllers[i].methods;
        var p1 = controllers[i].path;
        var comment = controllers[i].comment;
        for (var j = 0; j < methods.length; j++) {
            var p2 = methods[j].decorates;
            var parameters = [];
            var methodType = methods[j].type;
            var inputForm = "query";
            var responses = {};
            var path_2 = { tags: [p1], operationId: p2, parameters: parameters, responses: responses };
            var methodComment = methods[j].comment;
            var returnTypedef = void 0;
            var returnTypename = void 0;
            if (methods[j].returnType != null) {
                returnTypedef = typeToJSON(methods[j].returnType, null);
                returnTypename = tsany.getTextOfNode(methods[j].returnType.typeName);
            }
            if (returnTypename == "Promise") {
                var promiseArg = methods[j].returnType.typeArguments[0];
                returnTypedef = typeToJSON(promiseArg, null, { expandRefs: true, docRoot: "#/components/schemas" });
            }
            if (methodComment != null && methodComment != "")
                path_2.description = methodComment;
            if (returnTypedef != null)
                responses["200"] = { description: "Successful response", content: { "application/json": { schema: returnTypedef } } };
            else
                responses["204"] = { description: "Successful response" };
            if (methodType == "post")
                inputForm = "body";
            for (var k = 0; k < methods[j].methodParameters.length; k++) {
                var parameter = methods[j].methodParameters[k];
                var parameterTypedef = typeToJSON(parameter.type, null, { expandRefs: true, docRoot: "#/components/schemas" });
                if (parameterTypedef != null && parameterTypedef.type == "object") {
                    for (var pname in parameterTypedef.properties) {
                        var isRequired = false;
                        if (parameterTypedef.required != null) {
                            for (var l = 0; l < parameterTypedef.required.length; l++) {
                                if (parameterTypedef.required[l] == pname)
                                    isRequired = true;
                            }
                        }
                        parameters.push({ name: pname, in: inputForm, schema: parameterTypedef.properties[pname], required: isRequired });
                    }
                }
                else
                    parameters.push({ in: inputForm, name: parameter.id, required: true, schema: parameterTypedef });
            }
            var pathId = '/' + p1 + '/' + p2;
            paths[pathId] = {};
            paths[pathId][methodType] = path_2;
        }
    }
    def.paths = paths;
}
function genRoutes(endpoints, controllers, srcRoot, routesFile) {
    var output = "\"use strict\";\n\n";
    output += "const express = require('express');\n";
    output += "const api = require('ts-api');\n";
    output += "const EndpointCheckBinding = api.EndpointCheckBinding;\n";
    for (var i = 0; i < controllers.length; i++) {
        var fileName = path.resolve(controllers[i].fileName);
        if (srcRoot != null) {
            fileName = fileName.replace(srcRoot + '/', '');
            fileName = fileName.replace(path.extname(fileName), "");
            output += "const " + controllers[i].className + "Module = require('./" + fileName + "');\n";
        }
        else
            output += "const " + controllers[i].className + "Module = require('./" + path.basename(fileName) + "');\n";
    }
    output += "\nlet binding = new EndpointCheckBinding(require('./__check'));\n";
    output += "\nmodule.exports = function(app) {\n";
    output += "  let rmeta = {};\n\n";
    for (var i = 0; i < controllers.length; i++)
        output += "  rmeta['" + controllers[i].className + "'] = { controller:new " + controllers[i].className + "Module.default(app,binding), router:express.Router() };\n";
    for (var i = 0; i < endpoints.length; i++) {
        var rfunc = endpoints[i].type;
        var endpointName = endpoints[i].decorates;
        var path_3 = endpointName;
        if (endpoints[i].decoratorArgs.length != 0)
            path_3 = endpoints[i].decoratorArgs[0];
        output += "\n";
        output += "  rmeta['" + endpoints[i].className + "'].router." + rfunc + "('/" + path_3 + "', async(req,res) => {\n";
        if (rfunc == 'get')
            output += "    const x = await rmeta['" + endpoints[i].className + "'].controller." + endpointName + "(req.query);\n\n";
        else
            output += "    const x = await rmeta['" + endpoints[i].className + "'].controller." + endpointName + "(req.body);\n\n";
        output += "    res.send(x);\n";
        output += "  });\n";
    }
    for (var i = 0; i < controllers.length; i++)
        output += "  app.use('/" + controllers[i].path + "',rmeta['" + controllers[i].className + "'].router);\n";
    output += "}\n";
    routesFile.write(output);
}
function genSources(items, packageName, srcRoot, checkFile, swaggerFile, routesFile) {
    var controllers = symtabToControllerDefinitions();
    var swaggerDefinitions = {};
    var contents_part1 = '';
    var contents_part2 = '';
    var contents_part3 = '';
    contents_part1 += "\n\nconst Ajv = require('ajv');\n";
    contents_part1 += "\nlet ajv = new Ajv();\n";
    contents_part3 += "\nfunction compositeWithDefinitions(schema) { schema.definitions = definitions; return schema; }\n";
    for (var i = 0; i < items.length; i++) {
        var x = parameterListToJSON(items[i]);
        if (x.parameterNames)
            x.schema.required = x.parameterNames;
        contents_part3 += genMethodEntry(x.className, x.method, x.parameterNames, x.schema);
    }
    var definitions = symtabToSchemaDefinitions();
    contents_part2 += "\n\nlet definitions = " + JSON.stringify(definitions, null, 2) + "\n";
    checkFile.write(contents_part1);
    checkFile.write(contents_part2);
    checkFile.write(contents_part3);
    genSwaggerPreamble(swaggerDefinitions, packageName, controllers);
    genSwaggerTags(swaggerDefinitions, controllers);
    genSwaggerPaths(swaggerDefinitions, controllers);
    swaggerDefinitions.components = { schemas: definitions };
    swaggerFile.write(JSON.stringify(swaggerDefinitions, null, 2) + "\n");
    genRoutes(items, controllers, srcRoot, routesFile);
}
function getFilenames(patterns) {
    var fa = [];
    for (var i = 0; i < patterns.length; i++) {
        var filenames = glob.sync(patterns[i]);
        for (var j = 0; j < filenames.length; j++)
            fa.push(filenames[j]);
    }
    return fa;
}
function genArgumentList(cexpr) {
    var argList = [];
    for (var _i = 0, _a = cexpr.arguments; _i < _a.length; _i++) {
        var arg = _a[_i];
        switch (arg.kind) {
            case ts.SyntaxKind.StringLiteral:
                {
                    var text = tsany.getTextOfNode(arg);
                    var s = text.replace(/^["']|["']$/g, '');
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
            default: throw ("unknown type (" + arg.kind + ") in decorator argument list");
        }
    }
    return argList;
}
function generate(patterns, options, packageName, srcRoot, checkFile, swaggarFile, routesFile) {
    var fa = getFilenames(patterns);
    var program = ts.createProgram(fa, options);
    var endpoints = [];
    var x = {};
    checker = program.getTypeChecker();
    function isNodeExported(node) {
        return (node.flags & ts.ModifierFlags.Export) !== 0 || (node.parent && node.parent.kind === ts.SyntaxKind.SourceFile);
    }
    function visitDecorator(node) {
        if (ts.isDecorator(node)) {
            var expr = node.expression;
            var parentName = "unknown";
            var methodParameters = [];
            var doRuntimeCheck = false;
            var doControllerEndpoint = false;
            var returnType = void 0;
            var comment = void 0;
            switch (node.parent.kind) {
                case ts.SyntaxKind.FunctionDeclaration:
                    {
                        var name_1 = (node.parent).name;
                        if (name_1 != null) {
                            var symbol = checker.getSymbolAtLocation(name_1);
                            parentName = name_1.text;
                            comment = ts.displayPartsToString(symbol.getDocumentationComment());
                        }
                        returnType = node.parent.type;
                        doRuntimeCheck = true;
                    }
                    break;
                case ts.SyntaxKind.MethodDeclaration:
                    {
                        var x_1 = (node.parent).name;
                        if (x_1 != null)
                            parentName = x_1.text;
                        var symbol = checker.getSymbolAtLocation(x_1);
                        var type = checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration);
                        var typeNode = checker.typeToTypeNode(type, node.parent, ts.NodeBuilderFlags.IgnoreErrors | ts.NodeBuilderFlags.WriteTypeParametersInQualifiedName);
                        comment = ts.displayPartsToString(symbol.getDocumentationComment());
                        returnType = node.parent.type;
                        methodParameters = traverseParameterList(typeNode.parameters);
                        doRuntimeCheck = true;
                    }
                    break;
                case ts.SyntaxKind.ClassDeclaration:
                    {
                        var classNameNode = (node.parent).name;
                        var className = classNameNode.text;
                        var symbol = checker.getSymbolAtLocation(classNameNode);
                        var source = (node.parent.parent);
                        comment = ts.displayPartsToString(symbol.getDocumentationComment());
                        ts.forEachChild(node.parent, visit);
                        addController(className, source.fileName, comment);
                        doControllerEndpoint = true;
                    }
                    break;
                default: throw ("unknown decorated type (" + node.parent.kind + ")");
            }
            if (ts.isCallExpression(expr)) {
                var cexpr = expr;
                var id = cexpr.expression;
                if (doRuntimeCheck) {
                    var className = id.parent.parent.parent.parent.name.text;
                    var item = {
                        className: className,
                        comment: comment,
                        decorates: parentName,
                        decoratorArgs: genArgumentList(cexpr),
                        methodParameters: methodParameters,
                        returnType: returnType,
                        type: id.text
                    };
                    endpoints.push(item);
                }
                else if (doControllerEndpoint) {
                    var classNameNode = (node.parent).name;
                    var controller = symtab[classNameNode.text];
                    controller.args = genArgumentList(cexpr);
                }
            }
        }
    }
    function visit2(node) {
        var parent = node.parent;
        var intf = parent;
        var x = intf.name;
        if (x != null) {
            switch (node.kind) {
                case ts.SyntaxKind.PropertySignature:
                    {
                        var parentName = x.text;
                        var sig = node;
                        var name_2 = sig.name;
                        var propertyName = void 0;
                        var symbol = checker.getSymbolAtLocation(name_2);
                        if (name_2.text)
                            propertyName = name_2.text;
                        if (propertyName && sig.type) {
                            var jsDoc = [];
                            var tags = symbol.getJsDocTags();
                            var comment = ts.displayPartsToString(symbol.getDocumentationComment());
                            var optional = sig.questionToken;
                            if (tags.length != 0) {
                                var tagSrc = ["/**", " *"];
                                for (var i = 0; i < tags.length; i++) {
                                    if (tags[i].name == "integer")
                                        tagSrc.push(" * @type {integer}");
                                    else
                                        tagSrc.push(" * @" + tags[i].name + " " + tags[i].text);
                                }
                                tagSrc.push(" */");
                                try {
                                    checkFile.write(tagSrc.join('\n'));
                                    jsDoc.push(doctrine.parse(tagSrc.join('\n'), { unwrap: true }));
                                }
                                catch (e) {
                                    throw ("invalid JSDoc: " + e);
                                }
                            }
                            var desc = typeToJSON(sig.type, jsDoc, { docRoot: "#/components/schemas" });
                            if (desc) {
                                symtab[parentName].members[propertyName] = { desc: desc, optional: optional };
                            }
                        }
                    }
                    break;
            }
        }
    }
    function visit(node) {
        if (node.decorators != null) {
            try {
                for (var _i = 0, _a = node.decorators; _i < _a.length; _i++) {
                    var decorator = _a[_i];
                    visitDecorator(decorator);
                }
            }
            catch (e) {
                console.log(e);
            }
        }
        else if (isNodeExported(node)) {
            var name_3 = node.name;
            var symbol = void 0;
            var comment = void 0;
            if (name_3 != null)
                symbol = checker.getSymbolAtLocation(name_3);
            if (name_3 != null)
                comment = ts.displayPartsToString(symbol.getDocumentationComment());
            if (node.kind == ts.SyntaxKind.ClassDeclaration) {
                ts.forEachChild(node, visit);
                symtab[name_3.text] = { type: "type", members: {}, jsDoc: null };
                symtab[name_3.text].comment = comment;
            }
            else if (node.kind == ts.SyntaxKind.InterfaceDeclaration) {
                if (name_3 != null) {
                    var tags = ts.displayPartsToString(symbol.getJsDocTags());
                    symtab[name_3.text] = { type: "type", members: {}, jsDoc: null };
                    symtab[name_3.text].comment = comment;
                    if (tags != "") {
                        symtab[name_3.text].jsDoc = doctrine.parse(tags);
                        //console.log(JSON.stringify(symtab[name.text].jsDoc,null,2));
                    }
                    ts.forEachChild(node, visit2);
                }
            }
        }
    }
    for (var _i = 0, _a = program.getSourceFiles(); _i < _a.length; _i++) {
        var sourceFile = _a[_i];
        console.log("visiting file: ", sourceFile.fileName);
        ts.forEachChild(sourceFile, visit);
    }
    connectMethods(endpoints);
    genSources(endpoints, packageName, srcRoot, checkFile, swaggarFile, routesFile);
}
module.exports = {
    generate: function (env, checkFile, swaggerFile, routesFile) {
        var src = env.programArgs.slice(2);
        if (src.length == 0)
            src = env.tsInclude;
        generate(src, { target: ts.ScriptTarget.ES5, module: ts.ModuleKind.CommonJS, experimentalDecorators: true }, env.packageName, env.srcRoot, checkFile, swaggerFile, routesFile);
    }
};
//# sourceMappingURL=analyzer.js.map