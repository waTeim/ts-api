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
/**
 *  This function translates a token found in an AST for a type declaration to the
 *  corresponding JSON schema definition.  The implementation for some objects is
 *  undefined (e.g. Function) and that token is ignored, unrecognized tokens cause
 *  an exception.
 *
 *  @param {any} o The AST token object.
 *  @param {any} jsDoc A reference to the JSDoc object.
 */
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
            res = { oneOf: [{ type: "object" }, { type: "number" }, { type: "string" }] };
            break;
        case ts.SyntaxKind.NullKeyword:
            res = { type: "null" };
            break;
        case ts.SyntaxKind.UndefinedKeyword: break;
        case ts.SyntaxKind.SymbolKeyword: break;
        case ts.SyntaxKind.ObjectKeyword:
            res = { type: "object" };
            break;
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
/**
 * This function converts typescript keywords to JSON schema.
 *
 * @param {string} docRoot The root path in the document object for JSDoc
 * definitions.  Used to construct $ref values.
 * @param {string} name The name of the typescript type.
 */
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
/**
 * Convert a typescript union declaration to JSON schema; this is supported
 * by use of the keyword oneOf.
 *
 * @param {any} typeDesc The AST subtree describing the union type.
 * @param {any} jsDoc A reference to the current JSDoc document.
 * @param {any} options Optional values effecting the output form. Currently
 * serves as a parameter to the recursive call to typeToJSON.
 */
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
/**
 * Create the JSON schema for a typescript literal type.  Literal types
 * can be expressed using the format keyword.
 *
 * @param {any} typeDesc The AST subtree describing the literal.
 * @param {any} jsDoc A reference to the current JSDoc document.
 */
function literalToJSON(typeDesc, jsDoc) {
    var type = checker.getTypeFromTypeNode(typeDesc);
    if (type.value != null) {
        return { type: (typeof type.value), oneOf: [{ format: type.value }] };
    }
    var literal = checker.typeToString(type);
    throw ("unknown literal type (" + literal + ")");
}
/**
 * This function adds the specified value tag to a JSON schema component.
 *
 * @param {any} schemaObject Reference to the schema component.
 * @param {string} title The value attribute name.
 * @param {any} value The value to set.
 */
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
/**
 * This function adds typing infomation to the speficied JSON schema component.
 *
 * @param {any} schemaObject Reference to the schema component.
 * @param {string} name The typename.
 */
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
/**
 * This function adds a tag to a JSON schema component.  The type of tag to apply
 * is inferred from the contents of the tag.
 * @param {any} schemaObject Reference to the schema component.
 * @param {any} tag The tag to apply.
 */
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
/**
 *  This function is the main entry point for converting a AST subtree describing a
 *  type declaration to its analogous JSON schema definition.  Some typescript features
 *  are not mappable currently (e.g. functions), while some are simply not implemented
 *  yet.  The typescript parser also collects JSDoc style comments associated with a
 *  type declaration and exposes that information in the AST as well.  These comments
 *  are also part of the output JSON schema.  The context of the use of the JSON schema
 *  can also effect the structure of the schema (e.g. use references to another part of
 *  the containing document, or expand fully all references).  Such infomation is passed
 *  using options.
 *
 *  @param {any} typeDesc Reference to the AST substree describing the type for which to
 *  create the JSON schema.
 *  @param {any} jsDoc The associated JSDoc comment.
 *  @param {any} options Affects the rules governing the structure of the resulting schema.
 */
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
                    if (typeDesc.typeName.text == "Array") {
                        var arg = typeDesc.typeArguments[0];
                        res = { type: "array", items: typeToJSON(arg, jsDoc, options) };
                    }
                    else {
                        res = maptypeDescName(docRoot, typeDesc.typeName.text);
                        if (res != null && res['$ref'] != null && options && options.expandRefs) {
                            if (symtab[typeDesc.typeName.text] == null)
                                throw ("undefined type " + typeDesc.typeName.text);
                            res = symtab[typeDesc.typeName.text].def;
                        }
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
            res.description = ts.displayPartsToString(symbol.getDocumentationComment(checker));
    }
    return res;
}
/**
 * This function marks all component types of a union type that is relevant as also relevant.
 *
 *  @param {any} typeDesc Reference to the AST substree describing the type.
 *  @param {any} jsDoc The associated JSDoc comment.
 *  @param {any} options Affects the rules governing the recursion.
 */
function markUnionAsRelevant(typeDesc, jsDoc, options) {
    var unionDesc = typeDesc;
    for (var i = 0; i < unionDesc.types.length; i++)
        markAsRelevant(unionDesc.types[i], null, options);
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
function markAsRelevant(typeDesc, jsDoc, options) {
    if (typeDesc.constructor.name == 'NodeObject') {
        switch (typeDesc.kind) {
            case ts.SyntaxKind.ArrayType:
                markAsRelevant(typeDesc.elementType, jsDoc, options);
                break;
            case ts.SyntaxKind.TypeReference:
                {
                    var typeName = typeDesc.typeName.text;
                    var args = typeDesc.typeArguments;
                    if (symtab[typeName] == null)
                        throw ("undefined type " + typeDesc.typeName.text);
                    symtab[typeName].relevant = true;
                    if (args != null) {
                        for (var i = 0; i < args.length; i++)
                            markAsRelevant(args[i], jsDoc, options);
                    }
                    for (var key in symtab[typeName].members) {
                        markAsRelevant(symtab[typeName].members[key].type, jsDoc, options);
                    }
                }
                break;
            case ts.SyntaxKind.UnionType:
                markUnionAsRelevant(typeDesc, jsDoc);
                break;
            default: break;
        }
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
    markAsRelevant(method.returnType, null, options);
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
/**
 * This function loops over the parameter list of a method and returns an array of
 * parameter describing interface objects.
 *
 * @param {any} parms The AST subtree describing the parameter list.
 */
function traverseParameterList(parms) {
    var parameterList = [];
    for (var i = 0; i < parms.length; i++) {
        parameterList.push({ id: parms[i].name.text, type: parms[i].type });
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
function connectMethods(endpoints) {
    for (var i = 0; i < endpoints.length; i++) {
        if (endpoints[i].className != null) {
            var controller = symtab[endpoints[i].className];
            if (controller != null)
                controller.methods.push(endpoints[i]);
        }
    }
}
/**
 * This function creates the JSON schema reference document that corresponds to
 * all marked (relevant) types defined in the global symbol table created from the
 * traversal of the AST of the typescript sources.
 *
 */
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
/**
 * Compiles the list of controller definitions by iterating over
 * the global pass 1 typescript source symbol table and creating a record
 * for each entry marked with type "controller".
 */
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
/**
 * Like above, compiles the list of router definitions by iterating over
 * the global pass 1 typescript source symbol table and creating a record
 * for each entry marked with type "router".
 */
function symtabToRouterDefinitions() {
    var res = [];
    for (var ikey in symtab) {
        if (symtab[ikey].type == "router") {
            var className = symtab[ikey].name;
            var path_2 = className;
            var comment = symtab[className].comment;
            var fileName = symtab[className].fileName;
            if (symtab[ikey].args != null && symtab[ikey].args[0] != null)
                path_2 = symtab[ikey].args[0];
            res.push({
                path: path_2,
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
function genArgsToSchema(parameterNames) {
    var s = '';
    s += "function(a) {\n";
    s += "    let o = {};\n\n";
    for (var i = 0; i < parameterNames.length; i++) {
        s += "    o['" + parameterNames[i] + "'] = a[" + i + "];\n";
    }
    s += "    return o;\n  }";
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
function genMethodEntry(className, methodName, parameterNames, schema) {
    var s = "\nexports[\"" + className + "." + methodName + "\"] = {\n";
    var schemaFormatted = JSON.stringify(schema, null, 2);
    schemaFormatted = schemaFormatted.replace(/\n/g, "\n  ");
    s += "  schema:compositeWithDefinitions(" + schemaFormatted + "),\n";
    s += "  argsToSchema:" + genArgsToSchema(parameterNames) + ",\n";
    s += "  validate:ajv.compile(compositeWithDefinitions(" + schemaFormatted + "))\n";
    s += "};\n";
    return s;
}
/**
 * Adds an entry for a controller to the global typescript source symbol table.
 *
 * @param {string} className the name of the class annotated by @controller.
 * @param {string} fileName the name of the file containing the controller definition.
 * @param {string} comment a JSDoc type comment of the controller.
 */
function addController(className, fileName, comment) {
    if (symtab[className] != null)
        throw ("multiple references to same class: " + className);
    symtab[className] = { type: "controller", name: className, fileName: fileName, comment: comment, methods: [], args: [] };
}
/**
 * Adds an entry for a router to the global typescript source symbol table.
 *
 * @param {string} className the name of the class annotated by @router.
 * @param {string} fileName the name of the file containing the router definition.
 * @param {string} comment a JSDoc type comment of the router.
 */
function addRouter(className, fileName, comment) {
    symtab[className] = { type: "router", name: className, fileName: fileName, comment: comment, methods: [], args: [] };
}
/**
 * Create the hardcoded first part of a swagger doc.  Global documentation derived from the
 * block comments of the controller classes as well as the class annotated with @router is set here.
 *
 * @param {any} def reference to the swagger doc.
 * @param {string} projectName the name of the project (is derived from package.json packageName).
 * @param {Router[]} array of router definitions (expected to be of length 1).
 * @param {Controller[]} array of controller definitions.
 */
function genSwaggerPreamble(def, projectName, routers, controllers) {
    var comments = "";
    for (var i = 0; i < routers.length; i++) {
        if (routers[i].comment != null && routers[i].comment != '')
            comments += routers[i].comment + "\n\n";
        for (var j = 0; j < controllers.length; j++) {
            if (controllers[j].comment != null && controllers[j].comment != '') {
                if (comments.length != 0)
                    comments += "\n\n";
                comments += controllers[j].path + "\n\n";
                comments += controllers[j].comment;
            }
        }
    }
    def.openapi = "3.0.0";
    def.info = { version: "1.0.0", title: projectName };
    if (comments.length != 0)
        def.info.description = comments;
}
/**
 * Generate swagger tags based on controller paths
 *
 * @param {any} def reference to the swagger doc.
 * @param {Router[]} array of router definitions (expected to be of length 1).
 * @param {Controller[]} array of controller definitions.
 */
function genSwaggerTags(def, routers, controllers) {
    var tags = [];
    for (var i = 0; i < controllers.length; i++) {
        tags.push({ path: controllers[i].path });
    }
    //def.tags = tags;
}
/**
 * Generate swagger paths (REST endpoints) given the combination of prefix, controller
 * paths and methods of those controllers.
 *
 * @param {any} def reference to the swagger doc.
 * @param {string} prefix top level path to pre-pend to all paths.
 * @param {Controller[]} array of controller definitions.
 */
function genSwaggerPaths(def, prefix, controllers) {
    var paths = {};
    for (var i = 0; i < controllers.length; i++) {
        var methods = controllers[i].methods;
        var p1 = controllers[i].path;
        var comment = controllers[i].comment;
        // strip any unnecessary '/' characters from the controller path
        if (p1.charAt(0) == '/')
            p1 = p1.substring(1);
        if (p1.charAt(p1.length - 1) == '.')
            p1 = p1.substring(0, p1.length - 1);
        // For each controller, iterate over every method and create a path
        // for it.  If the method verb decorator contains a path use it, otherwise
        // use the name of the method itself.
        for (var j = 0; j < methods.length; j++) {
            var p2 = methods[j].decorates;
            var parameters = [];
            var methodType = methods[j].type;
            var inputForm = "query";
            var responses = {};
            var path_3 = { tags: [p1], operationId: p2, parameters: parameters, responses: responses };
            var methodComment = methods[j].comment;
            var returnTypedef = void 0;
            var returnTypename = void 0;
            if (methods[j].returnType != null) {
                returnTypedef = typeToJSON(methods[j].returnType, null);
                returnTypename = tsany.getTextOfNode(methods[j].returnType.typeName);
            }
            // If the method return type is a promise infer that this is an async function and
            // instead use the subordinate type as the type defined by the swagger doc.
            if (returnTypename == "Promise") {
                var promiseArg = methods[j].returnType.typeArguments[0];
                returnTypedef = typeToJSON(promiseArg, null, { expandRefs: true, docRoot: "#/components/schemas" });
            }
            if (methodComment != null && methodComment != "")
                path_3.description = methodComment;
            if (returnTypedef != null)
                responses["200"] = { description: "Successful response", content: { "application/json": { schema: returnTypedef } } };
            else
                responses["204"] = { description: "Successful response" };
            if (methodType == "post" || methodType == "all" || methodType == "delete")
                inputForm = "body";
            // Create the input doc swagger definition given the method parameters.  Recursively expand
            // objects rather that using JSON schema $ref, and if a method parameter is of type object, then
            // assume it's a class or interance and instead generate a swagger doc that is the members of
            // that aggregate.
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
            var pathId = '/' + prefix + '/' + p1 + '/' + p2;
            paths[pathId] = {};
            paths[pathId][methodType] = path_3;
        }
    }
    def.paths = paths;
}
/**
 * Generate all paths belonging to a router.  The expectation is that currently there will
 * only be a singleton router.
 *
 * @param {any} def reference to the swagger doc.
 * @param {Router[]} array of router definitions (expected to be of length 1).
 * @param {Controller[]} array of controller definitions.
 */
function genSwaggerRoutes(def, routers, controllers) {
    if (routers.length == 0)
        throw ("No Router Definitions Found");
    for (var i = 0; i < routers.length; i++) {
        var prefix = routers[i].path;
        if (prefix.charAt(0) == '/')
            prefix = prefix.substring(1);
        if (prefix.charAt(prefix.length - 1) == '.')
            prefix = prefix.substring(0, prefix.length - 1);
        genSwaggerPaths(def, prefix, controllers);
    }
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
 * @param {Router[]} routers array of router. It is assumed to be of length 1.
 * @param {Controller[]} controllers array of method controllers
 * @param {NodeJS.ReadWriteStream} routesFile reference to the routes output file.
 */
function genRoutes(endpoints, routers, controllers, srcRoot, routesFile) {
    var output = "\"use strict\";\n\n";
    output += "const express = require('express');\n";
    output += "const api = require('ts-api');\n";
    output += "const EndpointCheckBinding = api.EndpointCheckBinding;\n";
    output += "const error_response = api.response.error;\n";
    output += "const success_response = api.response.success;\n";
    // Generate requires for controller classes.  Use parser support for
    // the file they are defined in to provide the parameter for require.
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
    // include support for automatic swagger document display endpoint.  Avoid
    // requiring that package directory by proxying the require through ts-api.
    // make use of the guaranteed location of the swagger doc that is generated
    // relative to the routes file.
    output += "const swaggerUi = api.swaggerUi;\n";
    output += "const swaggerDocument = require('./docs/swagger.json');\n";
    output += "\nlet binding = new EndpointCheckBinding(require('./__check'));\n";
    output += "\nmodule.exports = function(apex) {\n";
    for (var j = 0; j < controllers.length; j++)
        output += "  apex.addRouter('" + controllers[j].className + "');\n";
    for (var j = 0; j < endpoints.length; j++) {
        var rfunc = endpoints[j].type;
        var endpointName = endpoints[j].decorates;
        var path_4 = endpointName;
        if (endpoints[j].decoratorArgs.length != 0)
            path_4 = endpoints[j].decoratorArgs[0];
        // For each method, tie everything together by creating the right controller instance,
        // collecting the express REST parameters, converting it to the method parameters, and then
        // invoking the method with those parameters.  Assume coordiation with the 
        // express verb decorator defined in this package.
        output += "\n";
        output += "  apex.getRouter('" + endpoints[j].className + "')." + rfunc + "('/" + path_4 + "', async(req,res,next) => {\n";
        output += "    try {\n";
        output += "      const controller = new " + endpoints[j].className + "Module.default(apex.app,binding,req,res,next);\n";
        if (rfunc == 'get' || rfunc == 'put')
            output += "      const x = await controller." + endpointName + "(req.query);\n\n";
        else
            output += "      const x = await controller." + endpointName + "(req.body);\n\n";
        output += "      success_response(x,req,res,next);\n";
        output += "    }\n";
        output += "    catch(e) { error_response(e,req,res,next); }\n";
        output += "  });\n";
    }
    for (var j = 0; j < controllers.length; j++) {
        var path_5 = controllers[j].path;
        if (path_5.charAt(0) == '/')
            path_5 = path_5.substring(1);
        if (path_5.charAt(path_5.length - 1) == '.')
            path_5 = path_5.substring(0, path_5.length - 1);
        output += "  apex.app.use(apex.prefix + '/" + path_5 + "',apex.getRouter('" + controllers[j].className + "'));\n";
    }
    output += "  apex.app.use(apex.prefix + '/docs',swaggerUi.serve,swaggerUi.setup(swaggerDocument));\n";
    output += "}\n";
    routesFile.write(output);
}
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
function genSources(items, packageName, srcRoot, checkFile, swaggerFile, routesFile) {
    var controllers = symtabToControllerDefinitions();
    var routers = symtabToRouterDefinitions();
    var swaggerDefinitions = {};
    var contents_part1 = '';
    var contents_part2 = '';
    var contents_part3 = '';
    contents_part1 += "\n\nconst Ajv = require('ajv');\n";
    contents_part1 += "\nlet ajv = new Ajv({ coerceTypes: true });\n";
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
    genSwaggerPreamble(swaggerDefinitions, packageName, routers, controllers);
    genSwaggerTags(swaggerDefinitions, routers, controllers);
    genSwaggerRoutes(swaggerDefinitions, routers, controllers);
    swaggerDefinitions.components = { schemas: definitions };
    swaggerFile.write(JSON.stringify(swaggerDefinitions, null, 2) + "\n");
    genRoutes(items, routers, controllers, srcRoot, routesFile);
}
/**
 * Use glob to contruct the list of input files to scan given a list of glob-type
 * patterns.
 *
 * @param {string[]} patterns array of glob-patterns describing the list of files.
 */
function getFilenames(patterns) {
    var fa = [];
    for (var i = 0; i < patterns.length; i++) {
        var filenames = glob.sync(patterns[i]);
        for (var j = 0; j < filenames.length; j++)
            fa.push(filenames[j]);
    }
    return fa;
}
/**
 * Extract arguments of relevant decorators for static analysis.  Some arguments
 * to decorators are needed at compile time for file generation (e.g. @controller
 * path).  This function finds these values for use later on in the 2nd pass.
 * Literal valuse can be used, but arguements only usable at runtime are ignored.
 *
 * @param {ts.CallExpression} cexpr AST subtree rooted with decorator type node.
 */
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
            case ts.SyntaxKind.FunctionExpression:
                console.log("   ignoring function in decorator argument list");
                break;
            default: throw ("unknown type (" + arg.kind + ") in decorator argument list");
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
function generate(patterns, options, packageName, srcRoot, checkFile, swaggerFile, routesFile) {
    var fa = getFilenames(patterns);
    var program = ts.createProgram(fa, options);
    var endpoints = [];
    var x = {};
    checker = program.getTypeChecker();
    function isNodeExported(node) {
        return (node.flags & ts.ModifierFlags.Export) !== 0 || (node.parent && node.parent.kind === ts.SyntaxKind.SourceFile);
    }
    // Recurse over all of the decorated functions, classes, etc and extract
    // relevant information and place that in a symbol table for later processing.
    function visitDecorator(node) {
        if (ts.isDecorator(node)) {
            var expr = node.expression;
            var dsym = checker.getSymbolAtLocation(expr.getFirstToken());
            var dname = dsym.getName();
            var parentName = "unknown";
            var methodParameters = [];
            var doRuntimeCheck = false;
            var doDecoratedClass = false;
            var returnType = void 0;
            var comment = void 0;
            switch (node.parent.kind) {
                case ts.SyntaxKind.FunctionDeclaration:
                    {
                        var name_1 = (node.parent).name;
                        if (name_1 != null) {
                            var symbol = checker.getSymbolAtLocation(name_1);
                            parentName = name_1.text;
                            comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
                        }
                        returnType = node.parent.type;
                        doRuntimeCheck = true;
                    }
                    break;
                case ts.SyntaxKind.MethodDeclaration:
                    {
                        if (dname == "get" || dname == "post" || dname == "put" || dname == "del" || dname == "all") {
                            var x_1 = (node.parent).name;
                            if (x_1 != null)
                                parentName = x_1.text;
                            var symbol = checker.getSymbolAtLocation(x_1);
                            var type = checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration);
                            var typeNode = checker.typeToTypeNode(type, node.parent, ts.NodeBuilderFlags.IgnoreErrors | ts.NodeBuilderFlags.WriteTypeParametersInQualifiedName);
                            comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
                            returnType = node.parent.type;
                            methodParameters = traverseParameterList(typeNode.parameters);
                            doRuntimeCheck = true;
                        }
                    }
                    break;
                case ts.SyntaxKind.ClassDeclaration:
                    {
                        var classNameNode = (node.parent).name;
                        var className = classNameNode.text;
                        var symbol = checker.getSymbolAtLocation(classNameNode);
                        var source = (node.parent.parent);
                        comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
                        ts.forEachChild(node.parent, visit);
                        if (dname == "controller") {
                            addController(className, source.fileName, comment);
                            doDecoratedClass = true;
                        }
                        else if (dname == "router") {
                            addRouter(className, source.fileName, comment);
                            doDecoratedClass = true;
                        }
                    }
                    break;
                default: throw ("unknown decorated type (" + node.parent.kind + ")");
            }
            if (ts.isCallExpression(expr)) {
                var cexpr = expr;
                var id = cexpr.expression;
                var type = id.text;
                if (type == "del")
                    type = "delete";
                if (doRuntimeCheck) {
                    var className = id.parent.parent.parent.parent.name.text;
                    var item = {
                        className: className,
                        comment: comment,
                        decorates: parentName,
                        decoratorArgs: genArgumentList(cexpr),
                        methodParameters: methodParameters,
                        returnType: returnType,
                        type: type
                    };
                    endpoints.push(item);
                }
                else if (doDecoratedClass) {
                    var classNameNode = (node.parent).name;
                    var entry = symtab[classNameNode.text];
                    entry.args = genArgumentList(cexpr);
                }
            }
        }
    }
    // Analyze the contents of a an interface declaration collect typing information
    // and JSDoc style comments.
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
                            var comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
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
                            // Create and save the JSON schema definition for a property for later use
                            var desc = typeToJSON(sig.type, jsDoc, { docRoot: "#/components/schemas" });
                            // Likewise save the comment
                            if (desc) {
                                symtab[parentName].members[propertyName] = { desc: desc, type: sig.type, optional: optional };
                            }
                        }
                    }
                    break;
            }
        }
    }
    // Recursively analyze an exported member of a source file.  Relevant
    // members include classes and interfaces and other refrenced types.
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
                comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
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
    // Loop over all the source files and recursively analyze each
    // exported member of that file.  Build a symbol table containing
    // relevant information, and then generate new source for 
    // automatic REST endpoints (which typeshcekcing) as well as
    // accompanying swagger.
    for (var _i = 0, _a = program.getSourceFiles(); _i < _a.length; _i++) {
        var sourceFile = _a[_i];
        console.log("visiting file: ", sourceFile.fileName);
        ts.forEachChild(sourceFile, visit);
    }
    connectMethods(endpoints);
    genSources(endpoints, packageName, srcRoot, checkFile, swaggerFile, routesFile);
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