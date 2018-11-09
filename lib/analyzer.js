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
        case ts.SyntaxKind.VoidKeyword:
            res = { type: "null" };
            break;
            break;
        default:
            unknown = true;
            break;
    }
    if (unknown)
        throw ("cannot convert unknown token (" + o.kind + ") to JSON");
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
 * Convert a typescript intersection declaration to JSON schema; this is supported
 * by use of the keyword allOf.
 *
 * @param {any} typeDesc The AST subtree describing the intersection type.
 * @param {any} jsDoc A reference to the current JSDoc document.
 * @param {any} options Optional values effecting the output form. Currently
 * serves as a parameter to the recursive call to typeToJSON.
 */
function intersectionToJSON(typeDesc, jsDoc, options) {
    var intersectionDesc = typeDesc;
    var res = { allOf: [] };
    for (var i = 0; i < intersectionDesc.types.length; i++) {
        var intersectionElement = typeToJSON(intersectionDesc.types[i], null, options);
        if (intersectionElement != null)
            res.allOf.push(intersectionElement);
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
    if (type.value != null)
        return { type: (typeof type.value), oneOf: [{ format: type.value }] };
    var literal = checker.typeToString(type);
    if (literal == "false" || literal == "true")
        return { type: "boolean" };
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
                    else if (typeDesc.typeName.text == "Date") {
                        res = { type: "string", format: "date-time", toDate: true };
                    }
                    else {
                        res = maptypeDescName(docRoot, typeDesc.typeName.text);
                        if (res != null && res['$ref'] != null && options && options.expandRefs) {
                            if (symtab[typeDesc.typeName.text] == null)
                                throw ("undefined type reference " + typeDesc.typeName.text);
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
            case ts.SyntaxKind.IntersectionType:
                res = intersectionToJSON(typeDesc, jsDoc);
                break;
            //case ts.SyntaxKind.TypeQuery: res = { type:"type query not implemented" }; break;
            //case ts.SyntaxKind.ParenthesizedType: res = { type:"parenthesized type not implemented" }; break;
            default:
                unknown = true;
                break;
        }
        if (unknown)
            throw ("cannot convert unknown type (" + typeDesc.kind + ") to JSON");
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
 * This function marks all component types of an intersection type that is relevant as also relevant.
 *
 *  @param {any} typeDesc Reference to the AST substree describing the type.
 *  @param {any} jsDoc The associated JSDoc comment.
 *  @param {any} options Affects the rules governing the recursion.
 */
function markIntersectionAsRelevant(typeDesc, jsDoc, options) {
    var intersectionDesc = typeDesc;
    for (var i = 0; i < intersectionDesc.types.length; i++)
        markAsRelevant(intersectionDesc.types[i], null, options);
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
                        throw ("undefined type " + typeDesc.typeName.text + " in relevancy tree");
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
            case ts.SyntaxKind.IntersectionType:
                markIntersectionAsRelevant(typeDesc, jsDoc);
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
function traverseParameterList(parms, decoratorMeta) {
    var parameterList = [];
    for (var i = 0; i < parms.length; i++) {
        parameterList.push({ id: parms[i].name.text, type: parms[i].type, decorators: decoratorMeta[parms[i].name.text] });
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
            if (controller != null) {
                if (controller.methods != null)
                    controller.methods.push(endpoints[i]);
                else
                    console.log("Ignoring endpoint " + endpoints[i].decorates + " of " + endpoints[i].className);
            }
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
 * Detects a url param variable in a path, returns metadata of the path.
 *
 * @param path {string} the path of a URL associated decorator (router,controller,method).
 */
function decomposePath(path) {
    var delimited = path.split('/');
    var urlParams = {};
    var pathComponents = [];
    for (var i = 0; i < delimited.length; i++) {
        if (delimited[i] != '') {
            if (delimited[i].match(/:.*/)) {
                var base = delimited[i].replace(/:/g, "");
                pathComponents.push(base);
                urlParams[base] = true;
            }
            else
                pathComponents.push(delimited[i]);
        }
    }
    return { pathComponents: pathComponents, urlParams: urlParams };
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
                args: symtab[ikey].args,
                className: className,
                comment: comment,
                fileName: fileName,
                methods: symtab[ikey].methods,
                decomposition: decomposePath(path_1)
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
            var pathComponents = path_2.split('/');
            var urlParams = [];
            for (var i = 0; i < pathComponents.length; i++) {
                if (pathComponents[i].match(/:.*/))
                    urlParams.push(pathComponents[i].replace(/:/g, ""));
            }
            res.push({
                args: symtab[ikey].args,
                className: className,
                comment: comment,
                fileName: fileName,
                decomposition: decomposePath(path_2)
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
 * Generates the the function "schemaToArgs" in __check.js.  This function
 * (as above) is generated 1 time for each relevant method, and likewise is
 * meant to reverse the effect of the above method.  This is to allow ajv
 * transformation side effects in validate to propogate forwared so it's not
 * simply a metter of just using the original argument list.
 *
 * @param {any} parameterNames the list of paremter names.
 */
function genSchemaToArgs(parameterNames) {
    var s = '';
    s += "function(o) {\n";
    s += "    let a = [];\n\n";
    for (var i = 0; i < parameterNames.length; i++) {
        s += "    a[" + i + "] = o['" + parameterNames[i] + "'];\n";
    }
    s += "    return a;\n  }";
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
    s += "  schemaToArgs:" + genSchemaToArgs(parameterNames) + ",\n";
    s += "  validate:validate(" + schemaFormatted + ")\n";
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
    symtab[className] = { type: "router", name: className, fileName: fileName, comment: comment, args: [] };
}
/**
 * Output a path of appropriate type-style by concetenating the components some of which
 * might also be urlParam type components.
 *
 * @param decomposition {PathDecomposition} The decomposed form of a path -- broken down into components.
 & @param pathType: Either swagger or express
 */
function decompositionToPath(decomposition, pathType) {
    var path = "";
    for (var i = 0; i < decomposition.pathComponents.length; i++) {
        var component = decomposition.pathComponents[i];
        if (path != "")
            path = path + '/';
        if (decomposition.urlParams[component]) {
            if (pathType == "swagger")
                path = path + '{' + component + '}';
            else
                path = path + ':' + component;
        }
        else
            path = path + component;
    }
    return path;
}
/**
 * Create the hardcoded first part of a swagger doc.  Global documentation derived from the
 * block comments of the controller classes as well as the class annotated with @router is set here.
 *
 * @param {any} def reference to the swagger doc.
 * @param {string} projectName the name of the project (is derived from package.json packageName).
 * @param {Router} router definition.
 * @param {Controller[]} array of controller definitions.
 */
function genSwaggerPreamble(def, projectName, router, controllers) {
    var comments = "";
    if (router.comment != null && router.comment != '')
        comments += router.comment + "\n\n";
    def.openapi = "3.0.0";
    def.info = { version: "1.0.0", title: projectName };
    if (comments.length != 0)
        def.info.description = comments;
}
/**
 * Generate swagger tags based on controller paths
 *
 * @param {any} def reference to the swagger doc.
 * @param {Router} router definition.
 * @param {Controller[]} array of controller definitions.
 */
function genSwaggerRootTags(def, router, controllers) {
    var tags = {};
    for (var i = 0; i < controllers.length; i++) {
        var tag = decompositionToPath(controllers[i].decomposition, "swagger");
        if (controllers[i].comment != null && controllers[i].comment != '')
            tags[tag] = { description: controllers[i].comment };
    }
    def.tags = tags;
}
function isURLParam(id, router, controller, methodPathDecomposition) {
    return router.decomposition.urlParams[id] || controller.decomposition.urlParams[id] || methodPathDecomposition.urlParams[id];
}
function genSwaggerPathParameters(router, controller, method, methodPathDecomposition) {
    var parameters = [];
    for (var i = 0; i < method.methodParameters.length; i++) {
        var parameter = method.methodParameters[i];
        var parameterTypedef = typeToJSON(parameter.type, null, { expandRefs: true, docRoot: "#/components/schemas" });
        if (parameterTypedef != null && parameterTypedef.type == "object") {
            for (var pname in parameterTypedef.properties) {
                if (isURLParam(pname, router, controller, methodPathDecomposition))
                    parameters.push({ name: pname, in: "path", schema: parameterTypedef.properties[pname], required: true });
            }
        }
        else {
            if (isURLParam(parameter.id, router, controller, methodPathDecomposition))
                parameters.push({ name: parameter.id, in: "path", schema: parameterTypedef, required: true });
        }
    }
    return parameters;
}
function genSwaggerRequestParameters(router, controller, method, methodPathDecomposition) {
    var parameters = [];
    // Create the input doc swagger definition given the method parameters.  Recursively expand
    // objects rather that using JSON schema $ref, and if a method parameter is of type object, then
    // assume it's a class or interance and instead generate a swagger doc that is the members of
    // that aggregate.
    for (var i = 0; i < method.methodParameters.length; i++) {
        var parameter = method.methodParameters[i];
        var parameterTypedef = typeToJSON(parameter.type, null, { expandRefs: true, docRoot: "#/components/schemas" });
        if (parameterTypedef != null && parameterTypedef.type == "object") {
            for (var pname in parameterTypedef.properties) {
                var isRequired = false;
                if (!isURLParam(pname, router, controller, methodPathDecomposition)) {
                    if (parameterTypedef.required != null) {
                        for (var l = 0; l < parameterTypedef.required.length; l++) {
                            if (parameterTypedef.required[l] == pname)
                                isRequired = true;
                        }
                    }
                    parameters.push({ name: pname, in: "query", schema: parameterTypedef.properties[pname], required: isRequired });
                }
            }
        }
        else if (!isURLParam(parameter.id, router, controller, methodPathDecomposition))
            parameters.push({ name: parameter.id, in: "query", schema: parameterTypedef, required: parameterTypedef.required });
    }
    return parameters;
}
function genSwaggerRequestBody(synthesizedTypes, router, controller, method, methodPathDecomposition) {
    var parameters = [];
    var parametersEx = [];
    for (var i = 0; i < method.methodParameters.length; i++) {
        var parameter = method.methodParameters[i];
        var parameterTypedef = typeToJSON(parameter.type, null, { docRoot: "#/components/schemas" });
        var parameterTypedefEx = typeToJSON(parameter.type, null, { expandRefs: true, docRoot: "#/components/schemas" });
        if (!isURLParam(parameter.id, router, controller, methodPathDecomposition)) {
            parameters.push({ name: parameter.id, required: parameterTypedef.required, schema: parameterTypedef });
            parametersEx.push({ name: parameter.id, required: parameterTypedefEx.required, schema: parameterTypedefEx });
        }
    }
    if (parameters.length == 1) {
        var jsonContent = { schema: parameters[0].schema };
        var formContent = { schema: parametersEx[0].schema };
        var encoding = {};
        var encodingPopulated = false;
        for (var property in parametersEx[0].schema.properties) {
            if (parametersEx[0].schema.properties[property].type == "object" || parametersEx[0].schema.properties[property] == null) {
                encoding[property] = { contentType: "application/json" };
                encodingPopulated = true;
            }
        }
        if (encodingPopulated)
            formContent["encoding"] = encoding;
        return {
            required: parameters[0].required,
            content: {
                "application/json": jsonContent,
                "application/x-www-form-urlencoded": formContent
            }
        };
    }
    else if (parameters.length > 1) {
        var methodName = method.decorates;
        var rqbName = "" + controller.className + methodName.substring(0, 1).toUpperCase() + methodName.substring(1) + "Body";
        var properties = {};
        var required = [];
        var notAllOptional = false;
        var inlineSchema = { type: "object", properties: properties };
        var encoding = {};
        var encodingPopulated = false;
        for (var i = 0; i < parameters.length; i++) {
            properties[parameters[i].name] = parameters[i].schema;
            if (parameters[i].schema.type == "object" || parameters[i].schema.type == null) {
                encoding[parameters[i].name] = { contentType: "application/json" };
                encodingPopulated = true;
            }
            if (parameters[i].required) {
                required.push(parameters[i].name);
                notAllOptional = true;
            }
        }
        var jsonContent = { schema: { "$ref": "#/components/schemas/" + rqbName } };
        var formContent = { schema: inlineSchema };
        if (encodingPopulated)
            formContent["encoding"] = encoding;
        synthesizedTypes[rqbName] = { type: "object", properties: properties, required: required, description: "synthesized request body type for " + controller.className + "." + methodName };
        return {
            required: notAllOptional,
            content: {
                "application/json": jsonContent,
                "application/x-www-form-urlencoded": formContent
            }
        };
    }
    else
        return { content: {} };
}
/**
 * Generate swagger paths (REST endpoints) given the combination of prefix, controller
 * paths and methods of those controllers.
 *
 * @param {any} def reference to the swagger doc.
 * @param {string} prefix top level path to pre-pend to all paths.
 * @param {Controller[]} array of controller definitions.
 */
function genSwaggerPaths(def, synthesizedTypes, router, controllers) {
    var paths = {};
    var p1 = decompositionToPath(router.decomposition, "swagger");
    for (var i = 0; i < controllers.length; i++) {
        var methods = controllers[i].methods;
        var p2 = decompositionToPath(controllers[i].decomposition, "swagger");
        var comment = controllers[i].comment;
        // For each controller, iterate over every method and create a path
        // for it.  If the method verb decorator contains a path use it, otherwise
        // use the name of the method itself.
        for (var j = 0; j < methods.length; j++) {
            var methodPath = methods[j].decorates;
            var parameters = [];
            var methodType = methods[j].type;
            var responses = {};
            var methodComment = methods[j].comment;
            var returnTypedef = void 0;
            var returnTypename = void 0;
            if (methods[j].decoratorArgs.length != 0)
                methodPath = methods[j].decoratorArgs[0];
            var methodPathDecomposition = decomposePath(methodPath);
            var p3 = decompositionToPath(methodPathDecomposition, "swagger");
            if (methods[j].returnType != null) {
                returnTypedef = typeToJSON(methods[j].returnType, null);
                returnTypename = tsany.getTextOfNode(methods[j].returnType.typeName);
            }
            else
                console.log("void return from a function", p3);
            // If the method return type is a promise infer that this is an async function and
            // instead use the subordinate type as the type defined by the swagger doc.
            if (returnTypename == "Promise") {
                var promiseArg = methods[j].returnType.typeArguments[0];
                returnTypedef = typeToJSON(promiseArg, null, { expandRefs: true, docRoot: "#/components/schemas" });
            }
            var path_3 = { tags: [p2], operationId: p3, responses: responses };
            var pathId = '/' + p2 + '/' + p3;
            var pathParameters = genSwaggerPathParameters(router, controllers[i], methods[j], methodPathDecomposition);
            if (methodComment != null && methodComment != "")
                path_3.description = methodComment;
            if (returnTypedef != null)
                responses["200"] = { description: "Successful response", content: { "application/json": { schema: returnTypedef } } };
            else
                responses["204"] = { description: "Successful response" };
            if (methodType == "post" || methodType == "all" || methodType == "put" || methodType == "patch") {
                if (pathParameters.length != 0)
                    path_3.parameters = pathParameters;
                path_3.requestBody = genSwaggerRequestBody(synthesizedTypes, router, controllers[i], methods[j], methodPathDecomposition);
            }
            else
                path_3.parameters = pathParameters.concat(genSwaggerRequestParameters(router, controllers[i], methods[j], methodPathDecomposition));
            if (p1 != "")
                pathId = '/' + p1 + pathId;
            if (paths[pathId] == null)
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
 * @param {Router} router definition.
 * @param {Controller[]} array of controller definitions.
 */
function genSwaggerRoutes(def, synthesizedTypes, router, controllers) {
    var prefix = decompositionToPath(router.decomposition, "swagger");
    genSwaggerPaths(def, synthesizedTypes, router, controllers);
}
function genControllerArgListA(params, endpointName) {
    var output = "";
    for (var i = 0; i < params.length; i++) {
        if (params[i].type.type == "object" || params[i].type.type == null) {
            if (params[i].kind == "urlParam")
                output += "      const " + params[i].id + " = (typeof req.params." + params[i].id + " == \"string\")?JSON.parse(req.params." + params[i].id + "):req.params." + params[i].id + ";\n";
            else
                output += "      const " + params[i].id + " = (typeof req.body." + params[i].id + " == \"string\")?JSON.parse(req.body." + params[i].id + "):req.body." + params[i].id + ";\n";
        }
        else {
            if (params[i].kind == "urlParam")
                output += "      const " + params[i].id + " = req.params." + params[i].id + ";\n";
            else
                output += "      const " + params[i].id + " = req.body." + params[i].id + ";\n";
        }
    }
    output += "      const x = await controller." + endpointName + "(";
    for (var i = 0; i < params.length; i++) {
        if (i != 0)
            output += ',';
        output += "" + params[i].id;
    }
    output += ");\n\n";
    return output;
}
function genControllerArgListB(params, endpointName) {
    var output = "";
    var argListFormal = [];
    for (var i = 0; i < params.length; i++) {
        if (params[i].kind == "urlParam") {
            if (params[i].type.type == "obiect" || params[i].type.type == null) {
                output += "      const " + params[i].id + " = (typeof req.params." + params[i].id + " == \"string\")?JSON.parse(req.params." + params[i].id + "):req.params." + params[i].id + ";\n";
                argListFormal.push(params[i].id);
            }
            else {
                output += "      const " + params[i].id + " = req.params." + params[i].id + ";\n";
                argListFormal.push(params[i].id);
            }
        }
        else {
            if (params[i].type.type = "object") {
                var properties = params[i].type.properties;
                console.log(properties);
                for (var propertyName in properties) {
                    if (properties[propertyName].type == "object" || properties[propertyName].type == null) {
                        output += "      const " + propertyName + " = (typeof req.body." + propertyName + " == \"string\")?JSON.parse(req.body." + propertyName + "):req.body." + propertyName + ";\n";
                        argListFormal.push(propertyName);
                    }
                    else {
                        output += "      const " + propertyName + " = req.body." + propertyName + ";\n";
                        argListFormal.push(propertyName);
                    }
                }
            }
            else {
                output += "      const " + params[i].id + " = req.body." + params[i].id + ";\n";
                argListFormal.push(params[i].id);
            }
        }
    }
    output += "      const x = await controller." + endpointName + "(";
    for (var i = 0; i < argListFormal.length; i++) {
        if (i != 0)
            output += ',';
        output += "" + argListFormal[i];
    }
    output += ");\n\n";
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
function genExpressRoutes(endpoints, router, controllers, srcRoot, routesFile) {
    var output = "\"use strict\";\n\n";
    var resolvedRoot;
    var controllerIndex = {};
    if (srcRoot != null)
        resolvedRoot = path.resolve(srcRoot);
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
            fileName = fileName.replace(resolvedRoot + '/', '');
            fileName = fileName.replace(path.extname(fileName), "");
            output += "const " + controllers[i].className + "Module = require('./" + fileName + "');\n";
        }
        else
            output += "const " + controllers[i].className + "Module = require('./" + path.basename(fileName) + "');\n";
        controllerIndex[controllers[i].className] = controllers[i];
    }
    // include support for automatic swagger document display endpoint.  Avoid
    // requiring that package directory by proxying the require through ts-api.
    // make use of the guaranteed location of the swagger doc that is generated
    // relative to the routes file.
    output += "const swaggerUi = api.swaggerUi;\n";
    output += "const swaggerDocument = require('./docs/swagger.json');\n";
    output += "\nlet binding = new EndpointCheckBinding(require('./__check'));\n";
    output += "\nmodule.exports = function(root) {\n";
    var routerPath = decompositionToPath(router.decomposition, "express");
    for (var i = 0; i < controllers.length; i++) {
        var path_4 = '/' + decompositionToPath(controllers[i].decomposition, "express");
        if (routerPath != "")
            path_4 = "/" + routerPath + path_4;
        output += "  root.addRouter('" + path_4 + "','" + controllers[i].className + "');\n";
    }
    for (var i = 0; i < endpoints.length; i++) {
        var rfunc = endpoints[i].type;
        var endpointName = endpoints[i].decorates;
        var path_5 = endpointName;
        if (endpoints[i].decoratorArgs.length != 0)
            path_5 = endpoints[i].decoratorArgs[0];
        var endpointPathDecomposition = decomposePath(path_5);
        var endpointPath = decompositionToPath(endpointPathDecomposition, "express");
        // For each method, tie everything together by creating the right controller instance,
        // collecting the express REST parameters, converting it to the method parameters, and then
        // invoking the method with those parameters.  Assume coordiation with the 
        // express verb decorator defined in this package.
        output += "\n";
        output += "  root.getExpressRouter('" + endpoints[i].className + "')." + rfunc + "('/" + endpointPath + "', async(req,res,next) => {\n";
        output += "    try {\n";
        if (rfunc != 'get' && rfunc != 'put') {
            output += "      if(req.body == null) throw(\"body is null (possible missing body parser)\")\n";
        }
        output += "      const controller = new " + endpoints[i].className + "Module.default(root.context,binding,req,res,next);\n";
        var params = [];
        var numURLParam = 0;
        // Gather parameter metadata prior to output
        for (var j = 0; j < endpoints[i].methodParameters.length; j++) {
            var parm = endpoints[i].methodParameters[j];
            var parmType = typeToJSON(parm.type, null, { expandRefs: true, docRoot: "#/components/schemas" });
            if (parm.decorators != null) {
                for (var decoratorName in parm.decorators) {
                    if (decoratorName == 'urlParam') {
                        var decoratorArgs = parm.decorators[decoratorName];
                        if (decoratorArgs.length)
                            params.push({ id: decoratorArgs[0], kind: "urlParam" });
                        else
                            params.push({ id: parm.id, kind: "urlParam", type: parmType });
                    }
                }
            }
            else if (isURLParam(parm.id, router, controllerIndex[endpoints[i].className], endpointPathDecomposition))
                params.push({ id: parm.id, kind: "urlParam", type: parmType });
            else
                params.push({ id: parm.id, kind: "regular", type: parmType });
        }
        if (params.length - numURLParam > 1)
            output += genControllerArgListA(params, endpointName);
        else
            output += genControllerArgListB(params, endpointName);
        output += "      success_response(x,req,res,next);\n";
        output += "    }\n";
        output += "    catch(e) { error_response(e,req,res,next); }\n";
        output += "  });\n";
    }
    var docPath = '/docs';
    if (routerPath != "")
        docPath = "/" + routerPath + docPath;
    output += "  root.getExpressRouter().use('" + docPath + "',swaggerUi.serve,swaggerUi.setup(swaggerDocument));\n";
    output += "  return root.getExpressRouter();\n";
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
    if (routers.length == 0)
        throw ("No Router Definitions Found");
    if (routers.length > 1)
        throw ("Multiple Router Definitions Found");
    contents_part1 += "const Ajv = require('ajv');\n";
    contents_part1 += "\nlet ajv = new Ajv({ coerceTypes: true });\n";
    contents_part1 += "\najv.addKeyword('toDate', {\n";
    contents_part1 += "  modifying: true,\n";
    contents_part1 += "  schema: false, \n";
    contents_part1 += "  valid: true, \n";
    contents_part1 += "  validate: function(data,dataPath,parentData,parentDataProperty) {\n";
    contents_part1 += "    if(typeof data == \"string\" && parentData != null) parentData[parentDataProperty] = new Date(data);\n";
    contents_part1 += "  }\n";
    contents_part1 += "});\n";
    contents_part3 += "\nfunction compositeWithDefinitions(schema) { schema.definitions = definitions; return schema; }\n";
    contents_part3 += "function validate(schema) { try { return ajv.compile(compositeWithDefinitions(schema)); } catch(e) { throw new Error(e); } }\n";
    for (var i = 0; i < items.length; i++) {
        var x = parameterListToJSON(items[i]);
        if (x.parameterNames)
            x.schema.required = x.parameterNames;
        contents_part3 += genMethodEntry(x.className, x.method, x.parameterNames, x.schema);
    }
    var definitions = symtabToSchemaDefinitions();
    var synthesizedTypes = {};
    contents_part2 += "\n\nlet definitions = " + JSON.stringify(definitions, null, 2) + "\n";
    checkFile.write(contents_part1);
    checkFile.write(contents_part2);
    checkFile.write(contents_part3);
    genSwaggerPreamble(swaggerDefinitions, packageName, routers[0], controllers);
    genSwaggerRootTags(swaggerDefinitions, routers[0], controllers);
    genSwaggerRoutes(swaggerDefinitions, synthesizedTypes, routers[0], controllers);
    for (var synthesizedTypename in synthesizedTypes)
        definitions[synthesizedTypename] = synthesizedTypes[synthesizedTypename];
    swaggerDefinitions.components = { schemas: definitions };
    swaggerFile.write(JSON.stringify(swaggerDefinitions, null, 2) + "\n");
    genExpressRoutes(items, routers[0], controllers, srcRoot, routesFile);
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
 * Literal values can be used, but arguements only usable at runtime are ignored.
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
                            var parameterContext = node.parent.parameters;
                            comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
                            returnType = node.parent.type;
                            var parms = typeNode.parameters;
                            var parmContext = node.parent.parameters;
                            var decoratorMeta = {};
                            for (var i = 0; i < parmContext.length; i++) {
                                if (parmContext[i].decorators != null) {
                                    for (var j = 0; j < parmContext[i].decorators.length; j++) {
                                        var dec = parmContext[i].decorators[j].expression;
                                        var dsym_1 = checker.getSymbolAtLocation(dec.getFirstToken());
                                        var dname_1 = dsym_1.getName();
                                        var parmDecl = dec.parent;
                                        var psym = checker.getSymbolAtLocation(parmDecl.parent.name);
                                        var pname = psym.getName();
                                        var decArgList = void 0;
                                        if (ts.isCallExpression(dec)) {
                                            decArgList = genArgumentList(dec);
                                        }
                                        if (decArgList == null)
                                            decArgList = [];
                                        if (decoratorMeta[pname] == null)
                                            decoratorMeta[pname] = {};
                                        decoratorMeta[pname][dname_1] = decArgList;
                                    }
                                }
                            }
                            methodParameters = traverseParameterList(typeNode.parameters, decoratorMeta);
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
                    var decoratorArgs = genArgumentList(cexpr);
                    var item = {
                        className: className,
                        comment: comment,
                        decorates: parentName,
                        decoratorArgs: decoratorArgs,
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
                                    //checkFile.write(tagSrc.join('\n'));
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
            var decl = node;
            var name_3 = decl.name;
            var symbol = void 0;
            var comment = void 0;
            if (name_3 != null)
                symbol = checker.getSymbolAtLocation(name_3);
            if (name_3 != null)
                comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
            if (decl.kind == ts.SyntaxKind.ClassDeclaration) {
                ts.forEachChild(decl, visit);
                symtab[name_3.text] = { type: "type", members: {}, jsDoc: null };
                symtab[name_3.text].comment = comment;
            }
            else if (decl.kind == ts.SyntaxKind.InterfaceDeclaration) {
                if (name_3 != null) {
                    var tags = ts.displayPartsToString(symbol.getJsDocTags());
                    symtab[name_3.text] = { type: "type", members: {}, jsDoc: null };
                    symtab[name_3.text].comment = comment;
                    if (tags != "") {
                        symtab[name_3.text].jsDoc = doctrine.parse(tags);
                        //console.log(JSON.stringify(symtab[name.text].jsDoc,null,2));
                    }
                    ts.forEachChild(decl, visit2);
                }
            }
            else if (decl.kind == ts.SyntaxKind.TypeAliasDeclaration) {
                var alias = decl;
                symtab[name_3.text] = { type: "type", members: {}, jsDoc: null };
                symtab[name_3.text].comment = comment;
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