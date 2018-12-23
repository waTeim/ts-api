import * as ts from "typescript";
import * as fs from "fs";
import * as glob from "glob";
import * as doctrine from "doctrine";
import * as path from "path";
import * as redoc from "./ReDoc";

const tsany = ts as any;

/**
 * Interface for recording the elements of a method parameter list
 */
interface TypedId {
  id: string,
  type: Object,
  decorators: any[]
};

/**
 * Simple object for holding the processing of a path; principally for
 * the result of url param detection and component assignement.
 */
interface PathDecomposition {
  pathComponents:string[],
  urlParams:Object
}

/**
 * Interface for collection of relevant information about class methods
 * annotated with REST verb decorators (e.g. @get, @post, etc).
 *
 */
interface DecoratedFunction {
  className: string,
  comment: string,
  decorates: string,
  decoratorArgs: any[],
  methodParameters: TypedId[],
  returnType: ts.TypeNode,
  type: string
};

/**
 * Interface for collection of relevant information about classes annotated
 * by the @controller decorator.
 *
 */
interface Controller {
  args: any[],
  className: string,
  fileName: string,
  comment: string,
  methods: DecoratedFunction[],
  decomposition: PathDecomposition
}

/**
 * Interface for collection of relevant information about classes annotated
 * by the @router decorator.
 *
 */
interface Router {
  args: any[],
  className: string,
  fileName: string,
  comment: string,
  decomposition: PathDecomposition
}

let symtab: any = {};
let checker;

/**
 *  This function translates a token found in an AST for a type declaration to the 
 *  corresponding JSON schema definition.  The implementation for some objects is
 *  undefined (e.g. Function) and that token is ignored, unrecognized tokens cause
 *  an exception.
 *
 *  @param {any} o The AST token object.
 *  @param {any} jsDoc A reference to the JSDoc object.
 */
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
    case ts.SyntaxKind.AnyKeyword: res = { anyOf:[ { type:"object" }, { type:"number" }, { type:"string" }]}; break;
    case ts.SyntaxKind.NullKeyword: res = { type:"null" }; break;
    case ts.SyntaxKind.UndefinedKeyword: break;
    case ts.SyntaxKind.SymbolKeyword: break;
    case ts.SyntaxKind.ObjectKeyword: res = { type:"object" }; break;
    case ts.SyntaxKind.FunctionType: break;
    case ts.SyntaxKind.VoidKeyword: res = { type:"null" }; break;
    break;
    default: unknown = true; break;
  }
  if(unknown) throw(`cannot convert unknown token (${o.kind}) to JSON`);
  else return res;
}

/**
 * This function converts typescript keywords to JSON schema.
 *
 * @param {string} docRoot The root path in the document object for JSDoc
 * definitions.  Used to construct $ref values.
 * @param {string} name The name of the typescript type.
 */
function mapTypeDescName(docRoot: string,name: string): Object {
  if(name == "Object") return { type:"object" };
  if(name == "String") return { type:"string" };
  if(name == "Number") return { type:"number" };
  if(name == "Boolean") return { type:"boolean" };
  if(name == "Function") return null;
  return { "$ref":`${docRoot}/${name}` };
}

/**
 * Convert a typescript union declaration to JSON schema; this is supported
 * by use of the keyword anyOf.
 * 
 * @param {any} typeDesc The AST subtree describing the union type.
 * @param {any} jsDoc A reference to the current JSDoc document.
 * @param {any} options Optional values effecting the output form. Currently
 * serves as a parameter to the recursive call to typeToJSON.
 */
function unionToJSON(typeDesc:any,jsDoc:any,options?:any):Object {
   let unionDesc = <ts.UnionTypeNode>typeDesc;
   let res = { anyOf:[] };

   for(let i = 0;i < unionDesc.types.length;i++) {
     let unionElement = typeToJSON(unionDesc.types[i],null,options);

     if(unionElement != null) res.anyOf.push(unionElement);
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
function intersectionToJSON(typeDesc:any,jsDoc:any,options?:any):Object {
   let intersectionDesc = <ts.IntersectionTypeNode>typeDesc;
   let res = { allOf:[] };

   for(let i = 0;i < intersectionDesc.types.length;i++) {
     let intersectionElement = typeToJSON(intersectionDesc.types[i],null,options);

     if(intersectionElement != null) res.allOf.push(intersectionElement);
   }
   return res;
}

/**
 * Create the JSON schema for a typescript literal type.  Literal types
 * can be expressed using the pattern keyword.
 *
 * @param {any} typeDesc The AST subtree describing the literal.
 * @param {any} jsDoc A reference to the current JSDoc document.
 */
function literalToJSON(typeDesc:any,jsDoc:any):Object {
  let type = checker.getTypeFromTypeNode(typeDesc);

  if(type.value != null) {
    let valueType = typeof type.value;

    if(valueType == "string") return { type:"string", pattern:`^${type.value}$` };
    else if(valueType == "number") {
      let numericValue = parseFloat(type.value);

      return { type:"number", minimum:numericValue, maximum:numericValue };
    }
  }
  
  let literal = checker.typeToString(type);

  if(literal == "false" || literal == "true") return { type:"boolean" };

  throw("unknown literal type (" + literal + ")");
}

function typeliteralToJSON(typeDesc:any,jsDoc:any,options?:any):Object {
  let typeliteralDesc = <ts.TypeLiteralNode>typeDesc;
  let properties = {};
  let required = [];
  let elements = [];

  for(let i = 0;i < typeliteralDesc.members.length;i++) {
    let element = <ts.TypeElement>typeliteralDesc.members[i];
    
    if(element.name != null) {
      let propertyName = tsany.getTextOfNode(element.name);

      properties[propertyName] = typeToJSON(element,null,options);
      if(element.questionToken == null) required.push(propertyName);
    }
    else elements.push(typeToJSON(element,null,options));
  }
  if(Object.keys(properties).length > 0 && elements.length == 0) {
    return { type:"object", properties:properties, required:required };
  }
  else if(elements.length != 0 && Object.keys(properties).length == 0) {
    return { anyOf:elements };
  }
  else {
    let type = checker.getTypeFromTypeNode(typeDesc);
    let literal = checker.typeToString(type);

    throw(`unable to map typeliteral containing both named and unnamed elements ${literal}`);
  }
}

function tupleTypeToJSON(typeDesc:any,jsDoc:any,options?:any):Object {
   let tupleDesc = <ts.TupleTypeNode>typeDesc;
   let res = { allOf:[] };
   
   for(let i = 0;i < tupleDesc.elementTypes.length;i++) {
     let tupleElement = typeToJSON(tupleDesc.elementTypes[i],null,options);
     
     if(tupleElement != null) res.allOf.push(tupleElement);
   }
   return res;
}

function indexedAccessTypeToJSON(typeDesc:any,jsDoc:any,options?:any):Object {
  let iaDesc = <ts.IndexedAccessTypeNode>typeDesc;
  let indexType = checker.getTypeFromTypeNode(typeDesc.indexType);
  let objectType = checker.getTypeFromTypeNode(typeDesc.objectType);
  let index = checker.typeToString(indexType);
  let objs = checker.typeToString(objectType);
  let res;

  if(index == "ArrayBuffer" && objs == "ArrayBufferTypes") return { type:"string", hint:{ encoding:"base64" }};
  return typeToJSON(typeDesc.objectType,jsDoc,options);
}

function mappedTypeToJSON(typeDesc:any,jsDoc:any,options?:any):Object {
  let mapDesc = <ts.MappedTypeNode>typeDesc;
  let constraint = ts.getEffectiveConstraintOfTypeParameter(mapDesc.typeParameter);
  let res;

  //console.log("next: ",typeDesc.nextContainer.type);
  let type = checker.getTypeFromTypeNode(typeDesc.nextContainer.type);
  let types = checker.typeToString(type);
  //console.log("subordinate type: ",types);
  //console.log("constraint: ",constraint);
  //console.log("desc: ",typeDesc);
  
  return typeToJSON(typeDesc.nextContainer.type,jsDoc,options);
}

function conditionalTypeToJSON(typeDesc:any,jsDoc:any,options?:any):Object {
  let conditionalDesc = <ts.ConditionalTypeNode>typeDesc;
  let type = checker.getTypeFromTypeNode(typeDesc);

  ///console.log("conditional type = ",checker.typeToString(type));

  return typeToJSON(conditionalDesc.extendsType,jsDoc,options);
}

/**
 * This function adds the specified value tag to a JSON schema component.
 *
 * @param {any} schemaObject Reference to the schema component.
 * @param {string} title The value attribute name.
 * @param {any} value The value to set.
 */
function applyValueTag(schemaObject: any,title: string,value: any): void {
  if(schemaObject.type != null && schemaObject.type != "null") schemaObject[title] = value;
    else if(schemaObject.oneOf != null) {
    for(let i = 0;i < schemaObject.oneOf.length;i++) {
      if(schemaObject.oneOf[i].type != null && schemaObject.oneOf[i].type != "null") schemaObject.oneOf[i][title] = value;
    }
  }
}

/** 
 * This function adds typing infomation to the speficied JSON schema component.
 *
 * @param {any} schemaObject Reference to the schema component.
 * @param {string} name The typename.
 */
function applyTypenameTag(schemaObject: any,name: string): void {
  if(schemaObject.type != null && schemaObject.type != "null") schemaObject.type = name;
  else if(schemaObject.oneOf != null) {
    for(let i = 0;i < schemaObject.oneOf.length;i++) {
      if(schemaObject.oneOf[i].type != null && schemaObject.oneOf[i].type != "null") schemaObject.oneOf[i].type = name;
    }
  }
}

/**
 * This function adds a tag to a JSON schema component.  The type of tag to apply
 * is inferred from the contents of the tag.
 * @param {any} schemaObject Reference to the schema component.
 * @param {any} tag The tag to apply.
 */
function applyTag(schemaObject: any,tag: any): void {
   if(tag == null) return;
   if(tag.title == "minimum" || tag.title == "maximum") applyValueTag(schemaObject,tag.title,parseInt(tag.description));
   else if(tag.title == "type") {
     if(tag.type.type == "NameExpression") applyTypenameTag(schemaObject,tag.type.name);
   }
}

function getTypeName(typeDesc) {
  if(typeDesc == null || typeDesc.typeName == null) return null;
  try {
    return tsany.getTextOfNode(typeDesc.typeName);
  }
  catch(e) {
    if(typeDesc.typeName.escapedText != null) return typeDesc.typeName.escapedText;
    throw("could not access typename");
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
function typeToJSON(typeDesc:any,jsDoc:any,options?:any):Object {
  let res;
  let type = checker.getTypeFromTypeNode(typeDesc);

  if(typeDesc== null) return { type:"object" };
  if(typeDesc.constructor.name == 'NodeObject') {
    let unknown = false;
    let docRoot = "#/definitions";
    let schemaId = "check";

    if(options != null && options.docRoot != null) docRoot = options.docRoot;
    if(options != null && options.schemaId != null) schemaId = options.schemaId;
    switch(typeDesc.kind) {
      case ts.SyntaxKind.ArrayType: res = { type:"array", items:typeToJSON(typeDesc.elementType,jsDoc,options) }; break;
      case ts.SyntaxKind.TypeReference: 
      {
        let typeName = getTypeName(typeDesc);

        if(typeName == "Array") {
          let arg = (<any>typeDesc).typeArguments[0];

          res = { type:"array", items:typeToJSON(arg,jsDoc,options) }
        }
        else if(typeName== "Date") {
          res = { oneOf:[{ type:"string", format:"date" }, { type:"string", format:"date-time" }], toDate:true, content:"flat" };
        }
        else {
          res = mapTypeDescName(docRoot,typeName);
          if(res != null && res['$ref'] != null && options && options.expandRefs) {
            if(symtab[typeName] == null) throw(`undefined type reference ${typeName}`);
            res = symtab[typeName].schema[schemaId];
          }
        }
      }
      break;
      case ts.SyntaxKind.PropertySignature:
      {
        let propertySignatureDesc:ts.PropertySignature = <ts.PropertySignature>typeDesc;

        if(propertySignatureDesc.type != null) res = typeToJSON(propertySignatureDesc.type,jsDoc,options);
        else res = null;
      }
      break;
      case ts.SyntaxKind.FunctionType: /* console.log(`ignoring function type ${checker.typeToString(type)}`); */ break;
      case ts.SyntaxKind.ConstructorType: /* console.log(`ignoring constructor type ${checker.typeToString(type)}`); */ break;
      case ts.SyntaxKind.TypeQuery: /* console.log(`ignoring type query ${checker.typeToString(type)}`); */ break;
      case ts.SyntaxKind.ParenthesizedType: /* console.log(`ignoring paranthesized type ${checker.typeToString(type)}`); */ break;
      case ts.SyntaxKind.IndexSignature: /* console.log(`ignoring index signature ${checker.typeToString(type)}`); */ break;
      case ts.SyntaxKind.UnionType: res = unionToJSON(typeDesc,jsDoc,options); break;
      case ts.SyntaxKind.LiteralType: res = literalToJSON(typeDesc,jsDoc); break;
      case ts.SyntaxKind.IntersectionType: res = intersectionToJSON(typeDesc,jsDoc,options); break;
      case ts.SyntaxKind.ConditionalType: res = conditionalTypeToJSON(typeDesc,jsDoc,options); break;
      case ts.SyntaxKind.TypeLiteral: res = typeliteralToJSON(typeDesc,jsDoc,options); break;
      case ts.SyntaxKind.MappedType: res = mappedTypeToJSON(typeDesc,jsDoc,options); break;
      case ts.SyntaxKind.TupleType: res = tupleTypeToJSON(typeDesc,jsDoc,options); break;
      case ts.SyntaxKind.IndexedAccessType: res = indexedAccessTypeToJSON(typeDesc,jsDoc,options); break;
      default: unknown = true; break;
    }
    if(unknown) throw(`cannot convert unknown type (${typeDesc.kind}) to JSON`); 
  }
  else if(typeDesc.constructor.name == 'TokenObject') res = tokenObjectToJSON(typeDesc,jsDoc);
  else throw(`unknown type (${typeDesc.constructor.name})`);

  if(res) {
    let symbol = type.symbol;

    if(jsDoc != null && jsDoc.length != 0) {
      for(let i = 0;i < jsDoc.length;i++) {
        if(jsDoc[i].tags != null && jsDoc[i].tags.length != 0) {
          for(let j = 0;j < jsDoc[i].tags.length;j++) applyTag(res,jsDoc[i].tags[j]);
        }
      }
    }
    if(symbol) res.description = ts.displayPartsToString(symbol.getDocumentationComment(checker));
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
        let typeName = getTypeName(typeDesc);
        let args = (<any>typeDesc).typeArguments;

        if(symtab[typeName] == null) {
          throw(`undefined type ${typeName} in relevancy tree`);
        }
        symtab[typeName].relevant = true;
        if(args != null) {
          for(let i = 0;i < args.length;i++) markAsRelevant(args[i],jsDoc,options);
        }
        for(let key in symtab[typeName].members) {
          markAsRelevant(symtab[typeName].members[key].type,jsDoc,options);
        }
        if(symtab[typeName].decl != null && symtab[typeName].decl.type != null) markAsRelevant(symtab[typeName].decl.type,jsDoc,options);
      }
      break;
      case ts.SyntaxKind.UnionType: markUnionAsRelevant(typeDesc,jsDoc,options); break;
      case ts.SyntaxKind.IntersectionType: markIntersectionAsRelevant(typeDesc,jsDoc,options); break;
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
  markAsRelevant(method.returnType,null,options);
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

/**
 * This function loops over the parameter list of a method and returns an array of
 * parameter describing interface objects.
 *
 * @param {any} parms The AST subtree describing the parameter list.
 */
function traverseParameterList(parms: any,decoratorMeta:any): TypedId[] {
  let parameterList:TypedId[] = [];

  for(let i = 0;i < parms.length;i++) {
    parameterList.push(<TypedId>{ id:parms[i].name.text, type:parms[i].type, decorators:decoratorMeta[parms[i].name.text]});
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
function connectMethods(endpoints:DecoratedFunction[]): void {
  for(let i = 0;i < endpoints.length;i++) {
    if(endpoints[i].className != null) {
      let controller = symtab[endpoints[i].className];
            
      if(controller != null) {
        if(controller.methods != null) controller.methods.push(endpoints[i]);
        else console.log(`Ignoring endpoint ${endpoints[i].decorates} of ${endpoints[i].className}`);
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
    let alias = <ts.TypeAliasDeclaration>typeDesc;

    if(alias.type) {
      isUnion = alias.type.kind == ts.SyntaxKind.UnionType;
      if(isUnion) typeDesc = alias.type;
    }
  }
  if(!isUnion) return false;

  let unionDesc = <ts.UnionTypeNode>typeDesc;
  let isMultiStatus = false;

  for(let i = 0;i < unionDesc.types.length;i++) {
    let unionElementTypename = getTypeName(unionDesc.types[i]);

    if(unionElementTypename != null && isExplicitStatus(unionElementTypename)) return true;
  }
  return false;
}

function isExplicitStatus(typeName) {
  return typeName == "Res";
}

/**
 * This function creates the JSON schema reference document that corresponds to
 * all marked (relevant) types defined in the global symbol table created from the 
 * traversal of the AST of the typescript sources.
 *
 */
function symtabToSchemaDefinitions(schemaId:string,docRoot:string): Object {
  let res = {};

  for(let ikey in symtab) {
    if(symtab[ikey].kind == "type" && symtab[ikey].relevant) {
      let required = [];
      let decl = symtab[ikey].decl;

      if(!isMagic(decl)) {
        if(decl.kind == ts.SyntaxKind.InterfaceDeclaration || decl.kind == ts.SyntaxKind.ClassDeclaration) {
          if(ikey != "Res") {
            res[ikey] = { type:"object", properties:{} };
            for(let mkey in symtab[ikey].members) {
              res[ikey].properties[mkey] = symtab[ikey].members[mkey].desc[schemaId];
              if(!symtab[ikey].members[mkey].optional) required.push(mkey);
            }
          }
        }
        else if(decl.type != null) res[ikey] = typeToJSON(decl.type,symtab[ikey].jsDoc,{ schemaId:schemaId, docRoot:docRoot });
        if(required.length > 0) res[ikey].required = required;
        if(symtab[ikey].comment != null) res[ikey].description = symtab[ikey].comment;
        if(symtab[ikey].schema == null) symtab[ikey].schema = {};
        symtab[ikey].schema[schemaId] = res[ikey];
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
function decomposePath(path:string): PathDecomposition {
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
function symtabToControllerDefinitions(): Controller[] {
  let res:Controller[] = [];

  for(let ikey in symtab) {
    if(symtab[ikey].kind == "controller") {
      let className = symtab[ikey].name;
      let path = className;
      let comment = symtab[className].comment;
      let fileName = symtab[className].fileName;

      if(symtab[ikey].args != null && symtab[ikey].args[0] != null) path = symtab[ikey].args[0];

      res.push({ 
        args: symtab[ikey].args,
        className:className,
        comment:comment,
        fileName:fileName,
        methods:symtab[ikey].methods,
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
function symtabToRouterDefinitions(): Router[] {
  let res:Router[] = [];

  for(let ikey in symtab) {
    if(symtab[ikey].kind == "router") {
      let className = symtab[ikey].name;
      let path = className;
      let comment = symtab[className].comment;
      let fileName = symtab[className].fileName;

      if(symtab[ikey].args != null && symtab[ikey].args[0] != null) path = symtab[ikey].args[0];
     
      let pathComponents = path.split('/');
      let urlParams:string[] = [];

      for(let i = 0;i < pathComponents.length;i++) {
        if(pathComponents[i].match(/:.*/)) urlParams.push(pathComponents[i].replace(/:/g,""));
      }

      res.push({
        args: symtab[ikey].args,
        className:className,
        comment:comment,
        fileName:fileName,
        decomposition:decomposePath(path)
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
function genArgsToSchema(parameterNames: any): string {
  let s = '';

  s += `function(a) {\n`;
  s += `    let o = {};\n\n`;
  for(let i = 0;i < parameterNames.length;i++) {
     s += `    o['${parameterNames[i]}'] = a[${i}];\n`;
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
function genSchemaToArgs(parameterNames: any): string {
  let s = '';

  s += `function(o) {\n`;
  s += `    let a = [];\n\n`;
  for(let i = 0;i < parameterNames.length;i++) {
     s += `    a[${i}] = o['${parameterNames[i]}'];\n`;
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
function genMethodEntry(className,methodName,parameterNames,schema): string {
  let s = `\nexports["${className}.${methodName}"] = {\n`;
  let schemaFormatted = JSON.stringify(schema,null,2);

  schemaFormatted = schemaFormatted.replace(/\n/g,"\n  ");
  s += `  schema:compositeWithDefinitions(${schemaFormatted}),\n`;
  s += `  argsToSchema:${genArgsToSchema(parameterNames)},\n`;
  s += `  schemaToArgs:${genSchemaToArgs(parameterNames)},\n`;
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
function addController(className:string,fileName: string,comment: string): void {
  if(symtab[className] != null) throw("multiple references to same class: " + className);
  symtab[className] = { kind:"controller", name:className, fileName:fileName, comment:comment, methods:[], args:[] };
}

/**
 * Adds an entry for a router to the global typescript source symbol table.
 *
 * @param {string} className the name of the class annotated by @router.
 * @param {string} fileName the name of the file containing the router definition.
 * @param {string} comment a JSDoc type comment of the router.
 */
function addRouter(className:string,fileName: string,comment: string): void {
  symtab[className] = { kind:"router", name:className, fileName:fileName, comment:comment, args:[] };
}

/**
 * Output a path of appropriate type-style by concetenating the components some of which
 * might also be urlParam type components.
 *
 * @param decomposition {PathDecomposition} The decomposed form of a path -- broken down into components.
 & @param pathType: Either swagger or express
 */
function decompositionToPath(decomposition:PathDecomposition,pathType:"swagger"|"express"):string {
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

/**
 * Create the hardcoded first part of a swagger doc.  Global documentation derived from the
 * block comments of the controller classes as well as the class annotated with @router is set here.
 *
 * @param {any} def reference to the swagger doc.
 * @param {string} projectName the name of the project (is derived from package.json packageName).
 * @param {Router} router definition.
 * @param {Controller[]} array of controller definitions.
 */
function genSwaggerPreamble(def: any,projectName:string,router:Router,controllers:Controller[]): void {
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
function genSwaggerRootTags(def: any,router:Router,controllers:Controller[]): void {
  let tags = {};

  for(let i = 0;i < controllers.length;i++) {
    let tag = decompositionToPath(controllers[i].decomposition,"swagger");

    if(controllers[i].comment != null && controllers[i].comment != '')
      tags[tag] = { description:controllers[i].comment };
  }
  def.tags = tags;
}

function isURLParam(id:string,router:Router,controller:Controller,methodPathDecomposition:PathDecomposition):boolean {
  return router.decomposition.urlParams[id] || controller.decomposition.urlParams[id] || methodPathDecomposition.urlParams[id];
}

function genSwaggerPathParameters(router:Router,controller:Controller,method:DecoratedFunction,methodPathDecomposition:PathDecomposition) {
  let parameters = [];

  for(let i = 0;i < method.methodParameters.length;i++) {
    let parameter = method.methodParameters[i];
    let parameterTypedef:any = typeToJSON(parameter.type,null,{ expandRefs:true, schemaId:"swagger", docRoot:"#/components/schemas" });

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
    let parameterTypedef:any = typeToJSON(parameter.type,null,{ expandRefs:true, docRoot:"#/components/schemas" });

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
    let parameterTypedef:any = typeToJSON(parameter.type,null,{ schemaId:"swagger", docRoot:"#/components/schemas" });
    let parameterTypedefEx:any = typeToJSON(parameter.type,null,{ expandRefs:true, schemaId:"swagger", docRoot:"#/components/schemas" });

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
    let methodName = method.decorates;
    let rqbName = `${controller.className}${methodName.substring(0,1).toUpperCase()}${methodName.substring(1)}Body`;
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
    synthesizedTypes[rqbName] = { type:"object", properties:properties, required:required, description:`synthesized request body type for ${controller.className}.${methodName}` };
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

function explicitStatus(returnTypeDesc:any) {
  let res = {};
 
  let statusCodeDesc = (<any>returnTypeDesc).typeArguments[0];
  let statusCode = checker.getTypeFromTypeNode(statusCodeDesc).value;
  let resReturnType = (<any>returnTypeDesc).typeArguments[1];
  let returnTypedef = typeToJSON(resReturnType,null,{ schemaId:"swagger", docRoot:"#/components/schemas" });

  if(returnTypedef != null) res[statusCode] = { description:"Successful response", content:{ "application/json":{ schema:returnTypedef }}};
  else res["204"] = { description:"Successful response" };
  return res;
}

function statusReturnMerge(resX:any,statusCode:string,resN:any) {
  if(resX[statusCode] == null) resX[statusCode] = resN;
  else {
    if(resX[statusCode].oneOf == null) {
      let tmp = resX[statusCode];

      resX[statusCode] = { oneOf:[] };
      resX[statusCode].oneOf.push(tmp);
    }
    resX[statusCode].oneOf.push(resN);
  }
}

function genSwaggerReturn(returnTypeDesc:any,res:any) {
  if(returnTypeDesc == null) return null;

  let returnTypedef = typeToJSON(returnTypeDesc,null,{ docRoot:"#/components/schemas" });
  let returnTypename = getTypeName(returnTypeDesc);

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
        let alias = symtab[returnTypename].decl;

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
          let unionElementTypename = getTypeName(unionDesc.types[i]);

          if(unionElementTypename != null) {
            if(!isExplicitStatus(unionElementTypename)) {
              let unionElement = typeToJSON(unionDesc.types[i],null,{ expandRefs:true, schemaId:"swagger", docRoot:"#/components/schemas" });

              if(unionElement != null) statusReturnMerge(resX,"200",unionElement);
            }
            else {
              let resY:any = explicitStatus(unionDesc.types[i]);

              for(let statusCode in resY) statusReturnMerge(resX,statusCode,resY[statusCode]);
            }
          }
          else {
            let unionElement = typeToJSON(unionDesc.types[i],null,{ expandRefs:true, schemaId:"swagger", docRoot:"#/components/schemas" });

            if(unionElement != null) statusReturnMerge(resX,"200",unionElement);
          }
        }
        for(let statusCode in resX) res[statusCode] = resX[statusCode];
      }
      else {
        returnTypedef = typeToJSON(returnTypeDesc,null,{ expandRefs:true, schemaId:"swagger", docRoot:"#/components/schemas" });
        if(returnTypedef != null) res["200"] = { description:"Successful response", content:{ "application/json":{ schema:returnTypedef }}};
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
    
    // For each controller, iterate over every method and create a path
    // for it.  If the method verb decorator contains a path use it, otherwise
    // use the name of the method itself.
    for(let j = 0;j < methods.length;j++) {
      let methodPath = methods[j].decorates;

      let parameters = [];
      let methodType = methods[j].type;
      let responses = {};
      let methodComment = methods[j].comment;

      if(methods[j].decoratorArgs.length != 0) methodPath = methods[j].decoratorArgs[0];

      let methodPathDecomposition = decomposePath(methodPath);
      let p3 = decompositionToPath(methodPathDecomposition,"swagger");

      // operationId is a unique identifier (across entire doc) for an operation
      let operationId = controllers[i].className + '-' + methods[j].decorates;

      let path:any = { tags:[p2], operationId: operationId, responses:responses };
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
function genSwaggerRoutes(def:any,synthesizedTypes:any,router:Router,controllers:Controller[]): void {
  let prefix = decompositionToPath(router.decomposition,"swagger");
   
  genSwaggerPaths(def,synthesizedTypes,router,controllers);
}

function genAssignment(id:string,dataSource:string,kind:string,type:string,content:string) {
  if(kind == "urlParam") {
    if(content != "flat" && (type == "object" || type == null))
      return `      const ${id} = (typeof req.params.${id} == "string")?JSON.parse(req.params.${id}):req.params.${id};\n`;
    else if(type == "array") 
      return `      const ${id} = Array.isArray(req.params.${id})?req.params.${id}):[req.params.${id}];\n`;
    else
      return `      const ${id} = req.params.${id};\n`;
  }
  else {
    if(content != "flat" && (type == "object" || type == null))
      return `      const ${id} = (typeof req.${dataSource}.${id} == "string")?JSON.parse(req.${dataSource}.${id}):req.${dataSource}.${id};\n`;
    else if(type == "array") 
      return `      const ${id} = Array.isArray(req.${dataSource}.${id})?req.${dataSource}.${id}:[req.${dataSource}.${id}];\n`;
    else
      return `      const ${id} = req.${dataSource}.${id};\n`;
  }
}

function genControllerArgListA(dataSource:string,params:any[],endpointName:string): string {
  let output = "";

  for(let i = 0;i < params.length;i++)
    output += genAssignment(params[i].id,dataSource,params[i].kind,params[i].type.type,params[i].type.content);
  output += `      const _x = await controller.${endpointName}(`;
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

  for(let i = 0;i < params.length;i++) {
    if(params[i].kind == "urlParam") {
      output += genAssignment(params[i].id,dataSource,params[i].kind,params[i].type.type,params[i].type.content);
      argListFormal.push(params[i].id);
    }
    else {
      if(params[i].type.type == "object") {
        let properties = params[i].type.properties;
        let objArgs = [];

        for(let propertyName in properties) {
          output += genAssignment(propertyName,dataSource,"regular",properties[propertyName].type,properties[propertyName].content);
          objArgs.push(propertyName);
        }
        argListFormal.push(objArgs);
      }
      else {
        output += genAssignment(params[i].id,dataSource,params[i].kind,params[i].type.type,params[i].type.content);
        argListFormal.push(params[i].id);
      }
    }
  }
  output += `      const _x = await controller.${endpointName}(`;
  for(let i = 0;i < argListFormal.length;i++) {
    if(i != 0) output += ',';
    if(typeof argListFormal[i] == "string") output += `${argListFormal[i]}`;
    else {
      output += "{ ";
      for(let j = 0;j < argListFormal[i].length;j++) {
        if(j != 0) output += ', ';
        output += `${argListFormal[i][j]}:${argListFormal[i][j]}`;
      }
      output += " }";
    }
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
function genExpressRoutes(endpoints:DecoratedFunction[],router:Router,controllers:Controller[],srcRoot: string,routesFile: NodeJS.ReadWriteStream):string {
  let output = `"use strict";\n\n`;
  let resolvedRoot;
  let controllerIndex = {};

  if(srcRoot != null) resolvedRoot = path.resolve(srcRoot);

  output += `const express = require('express');\n`;
  output += `const api = require('ts-api');\n`;
  output += `const EndpointCheckBinding = api.EndpointCheckBinding;\n`;
  output += `const error_response = api.response.error;\n`;
  output += `const success_response = api.response.success;\n`;

  // Generate requires for controller classes.  Use parser support for
  // the file they are defined in to provide the parameter for require.
  for(let i = 0;i < controllers.length;i++) {
    let fileName = path.resolve(controllers[i].fileName);

    if(srcRoot != null) {
      fileName = fileName.replace(resolvedRoot + '/','');
      fileName = fileName.replace(path.extname(fileName),"");
      output += `const ${controllers[i].className}Module = require('./${fileName}');\n`;
    }
    else output += `const ${controllers[i].className}Module = require('./${path.basename(fileName)}');\n`;
    controllerIndex[controllers[i].className] = controllers[i];
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
    output += `  root.addRouter('${path}','${controllers[i].className}',{ mergeParams:true });\n`;
  }

  for(let i = 0;i < endpoints.length;i++) {
    let rfunc = endpoints[i].type;
    let endpointName = endpoints[i].decorates;
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
    output += `  root.getExpressRouter('${endpoints[i].className}').${rfunc}('/${endpointPath}', async(req,res,next) => {\n`;
    output += `    try {\n`;
    if(rfunc != 'get') {
      output += `      if(req.body == null) throw("body is null (possible missing body parser)")\n`;
      dataSource = "body";
    }
    output += `      const controller = new ${endpoints[i].className}Module.default(root.context,binding,req,res,next);\n`
  
    let params = [];
    let numURLParam = 0;

    // Gather parameter metadata prior to output
    for(let j = 0;j < endpoints[i].methodParameters.length;j++) {
      let parm = endpoints[i].methodParameters[j];
      let parmType = typeToJSON(parm.type,null,{ expandRefs:true, schemaId:"swagger", docRoot:"#/definitions" })

      if(parm.decorators != null) {
        for(let decoratorName in parm.decorators) {
          if(decoratorName == 'urlParam') {
            let decoratorArgs = parm.decorators[decoratorName];

            if(decoratorArgs.length) params.push({ id:decoratorArgs[0], kind:"urlParam" });
            else params.push({ id:parm.id, kind: "urlParam", type:parmType });
            numURLParam += 1;
          }
        }
      }
      else if(isURLParam(parm.id,router,controllerIndex[endpoints[i].className],endpointPathDecomposition)) {
        params.push({ id:parm.id, kind: "urlParam", type:parmType });
        numURLParam += 1;
      }
      else
        params.push({ id:parm.id, kind: "regular", type:parmType });
    }
    if(params.length - numURLParam > 1) output += genControllerArgListA(dataSource,params,endpointName);
    else output += genControllerArgListB(dataSource,params,endpointName);
    output += `      success_response(_x,req,res,next);\n`;
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

function genRedoc(swaggerPath:string,redocFile:NodeJS.ReadWriteStream): void {
  redocFile.write(redoc.src(swaggerPath));
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
  contents_part1 += `\nlet ajv = new Ajv({ coerceTypes: true });\n`;
  contents_part1 += `\najv.addKeyword('toDate', {\n`;
  contents_part1 += `  modifying: true,\n`;
  contents_part1 += `  schema: false, \n`;
  contents_part1 += `  valid: true, \n`;
  contents_part1 += `  validate: function(data,dataPath,parentData,parentDataProperty) {\n`;
  contents_part1 += `    if(typeof data == "string" && parentData != null) parentData[parentDataProperty] = new Date(data);\n`;
  contents_part1 += `  }\n`;
  contents_part1 += `});\n`;

  contents_part3 += `\nfunction compositeWithDefinitions(schema) { schema.definitions = definitions; return schema; }\n`;
  contents_part3 += `function validate(schema) { try { return ajv.compile(compositeWithDefinitions(schema)); } catch(e) { throw new Error(e); } }\n`;

  for(let i = 0;i < items.length;i++) {
    let x = <any>parameterListToJSON(items[i]);

    if(x.parameterNames) x.schema.required = x.parameterNames;
    contents_part3 += genMethodEntry(x.className,x.method,x.parameterNames,x.schema);
  }

  let definitions1 = symtabToSchemaDefinitions("check","#/definitions");
  let definitions2 = symtabToSchemaDefinitions("swagger","#/components/schemas");
  let synthesizedTypes = {};

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
function generate(
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

  checker = program.getTypeChecker();
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
            comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
          }
          returnType = (<ts.FunctionDeclaration>node.parent).type;
          doRuntimeCheck = true;
        }
        break;
        case ts.SyntaxKind.MethodDeclaration:
        {  
          if(dname == "get" || dname == "post" || dname == "put" || dname == "del" || dname == "all") {
            let x = (<ts.FunctionDeclaration>(node.parent)).name;

            if(x != null) parentName = x.text;

            let symbol = checker.getSymbolAtLocation(x);
            let type = checker.getTypeOfSymbolAtLocation(symbol,symbol.valueDeclaration);
            let typeNode = checker.typeToTypeNode(type,node.parent,ts.NodeBuilderFlags.IgnoreErrors|ts.NodeBuilderFlags.WriteTypeParametersInQualifiedName);
            let parameterContext = (<ts.MethodDeclaration>node.parent).parameters;
          
            comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
            returnType = (<ts.MethodDeclaration>node.parent).type;

            let parms = (<any>typeNode).parameters;
            let parmContext = (<ts.MethodDeclaration>node.parent).parameters;
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

          comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
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
        let type = id.text;

        if(type == "del") type = "delete";
        if(doRuntimeCheck) {
          let className = (<any>id.parent.parent.parent.parent).name.text;
          let decoratorArgs = genArgumentList(cexpr);

          let item:DecoratedFunction = { 
            className:className,
            comment:comment,
            decorates:parentName,
            decoratorArgs:decoratorArgs,
            methodParameters:methodParameters,
            returnType:returnType,
            type:type
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

  // Analyze the contents of a an interface declaration collect typing information
  // and JSDoc style comments.
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
             let comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
             let optional = sig.questionToken;

             if(tags.length != 0) {
               let tagSrc = ["/**"," *"];

               for(let i = 0;i < tags.length;i++) {
                 if(tags[i].name == "integer") tagSrc.push(" * @type {integer}");
                 else tagSrc.push(` * @${tags[i].name } ${tags[i].text}`);
               }
               tagSrc.push(" */");
               try {
                 //checkFile.write(tagSrc.join('\n'));
                 jsDoc.push(doctrine.parse(tagSrc.join('\n'),{ unwrap:true }));
               } 
               catch(e) { throw("invalid JSDoc: " + e); }
             }

             // Create and save the JSON schema definition for a property for later use
             let checkDesc = typeToJSON(sig.type,jsDoc,{ schemaId:"check", docRoot:"#/definitions" });
             let swaggerDesc = typeToJSON(sig.type,jsDoc,{ schemaId:"swagger", docRoot:"#/components/schemas" });

             // Likewise save the comment
             if(checkDesc != null && swaggerDesc != null) {
               symtab[parentName].members[propertyName] = { desc:{ check:checkDesc, swagger:swaggerDesc }, type:sig.type, optional:optional };
             }
           }
         }
         break;
       }
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
      let symbol;    
      let comment;

      if(name != null) symbol = checker.getSymbolAtLocation(name);
      if(name != null) comment = ts.displayPartsToString(symbol.getDocumentationComment(checker));
      if(decl.kind == ts.SyntaxKind.TypeAliasDeclaration) {
        let alias = <ts.TypeAliasDeclaration>decl;

        ts.forEachChild(decl,visit);
        symtab[name.text] = { kind:"type", decl:node, members:{}, jsDoc:null };
        symtab[name.text].comment = comment;
      }
      else if(decl.kind == ts.SyntaxKind.ClassDeclaration) {
        ts.forEachChild(decl,visit);
        symtab[name.text] = { kind:"type", decl:node, members:{}, jsDoc:null };
        symtab[name.text].comment = comment;
      }
      else if(decl.kind == ts.SyntaxKind.InterfaceDeclaration) {
        if(name != null) {
          let tags = ts.displayPartsToString(symbol.getJsDocTags());
  
          symtab[name.text] = { kind:"type", decl:node, members:{}, jsDoc:null };
          symtab[name.text].comment = comment;
          if(tags != "") symtab[name.text].jsDoc = doctrine.parse(tags);
          ts.forEachChild(decl,visit2);
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
  connectMethods(endpoints);
  genSources(endpoints,packageName,srcRoot,checkFile,swaggerFile,redocFile,routesFile);
}

module.exports = {
  generate:function(env,checkFile,swaggerFile,redocFile,routesFile) {
    let src = env.programArgs.slice(2);

    if(src.length == 0) src = env.tsInclude;
    generate(
      src,
      { target:ts.ScriptTarget.ES5, module: ts.ModuleKind.CommonJS, experimentalDecorators:true },
      env.packageName,
      env.srcRoot,
      checkFile,
      swaggerFile,
      redocFile,
      routesFile,
      env.debug
    );
  }
}

