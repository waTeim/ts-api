import * as ts from "typescript";
import { TypedId, PathDecomposition, DecoratedFunction, Controller, Router } from "./types";

const tsany = ts as any;

let symtab: any = {};
let schemaRefIds:any = {};
let numIntermediates = 0;
let checker;

function getSourceContext(n:ts.Node) {
  let start = n;

  while(n != null && n.parent != null && n.parent.kind != ts.SyntaxKind.SourceFile) n = n.parent;
  if(n != null && n.parent != null) {
    let loc = ts.getLineAndCharacterOfPosition((<ts.SourceFile>n.parent),(<ts.Node>start).pos);

    return { fileName:(<ts.SourceFile>n.parent).fileName, lineNumber:loc.line };
  }
}

function setChecker(program) {
  checker = program.getTypeChecker();
}

function symtabKeyToString(key:any) {
  if(typeof key == "string") return key;
  else if(typeof key == "object") {
    if(key.module != null && key.local != null) return `${key.module}${key.local}`;
    if(key.local != null) return key.local;
  }
  return null;
}

function symtabGet(key:any):any {
  let s = symtabKeyToString(key);

  if(s != null) return symtab[s];
  return null;
}

function newSchemaRefId(key:any) {
  if(typeof key == "string") return key;
  if(key.local != null) {
    if(schemaRefIds[key.local] == null) {
      schemaRefIds[key.local] = { ext:1 }; 
      return key.local;
    }
    else schemaRefIds[key.local].ext++;
    return `${key.local}-${schemaRefIds[key.local].ext}`;
  }
}

function symtabPut(key:any,obj:any):any {
  let s = symtabKeyToString(key);

  if(s != null) {
    symtab[s] = obj;
    symtab[s].schemaRefId = newSchemaRefId(key);
    return obj;
  }
  return null;
}

function storeIntermediate(obj:any) {
  let key = { local:`Intermediate${numIntermediates++}`, module:"ts-api" }
 
  obj.kind = "itype";
  symtabPut(key,obj);
  return key.local;
}

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
    case ts.SyntaxKind.AnyKeyword: res = { anyOf:[ { type:"array" }, { type:"object" }, { type:"number" }, { type:"string" }]}; break;
    case ts.SyntaxKind.NullKeyword: res = { type:"null" }; break;
    case ts.SyntaxKind.UndefinedKeyword: break;
    case ts.SyntaxKind.SymbolKeyword: break;
    case ts.SyntaxKind.ObjectKeyword: res = { type:"object" }; break;
    case ts.SyntaxKind.FunctionType: break;
    case ts.SyntaxKind.VoidKeyword: res = { type:"null" }; break;
    case ts.SyntaxKind.NeverKeyword: break;
    break;
    default: unknown = true; break;
  }
  if(unknown) {
    let sc = getSourceContext(o);

    if(sc != null) 
      throw(`cannot convert unknown token (${o.kind}) to JSON\n file = ${sc.fileName} line = ${sc.lineNumber}`);
    throw(`cannot convert unknown token (${o.kind}) to JSON`);
  }
  return res;
}

/**
 * This function converts typescript keywords to JSON schema.
 *
 * @param {string} docRoot The root path in the document object for JSDoc
 * definitions.  Used to construct $ref values.
 * @param {string} name The name of the typescript type.
 */
function mapTypeDescName(docRoot:string,name:string): Object {
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
function unionToJSON(typeDesc:any,jsDoc:any,context?:any):Object {
   let unionDesc = <ts.UnionTypeNode>typeDesc;
   let res = { anyOf:[] };

   for(let i = 0;i < unionDesc.types.length;i++) {
     let unionElement = typeToJSON(unionDesc.types[i],null,context);

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
function intersectionToJSON(typeDesc:any,jsDoc:any,context?:any):Object {
   let intersectionDesc = <ts.IntersectionTypeNode>typeDesc;
   let res = { allOf:[] };

   for(let i = 0;i < intersectionDesc.types.length;i++) {
     let intersectionElement = typeToJSON(intersectionDesc.types[i],null,context);

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

  let sc = getSourceContext(typeDesc);

  if(sc != null)
    throw(`unknown literal type (${literal})\n file = ${sc.fileName} line = ${sc.lineNumber}`);
  throw(`unknown literal type (${literal})`);
}

function typeliteralToJSON(typeDesc:any,jsDoc:any,context?:any):Object {
  let typeliteralDesc = <ts.TypeLiteralNode>typeDesc;
  let properties = {};
  let required = [];
  let elements = [];

  for(let i = 0;i < typeliteralDesc.members.length;i++) {
    let element = <ts.TypeElement>typeliteralDesc.members[i];
    
    if(element.name != null) {
      let propertyName = tsany.getTextOfNode(element.name);

      properties[propertyName] = typeToJSON(element,null,context);
      if(element.questionToken == null) required.push(propertyName);
    }
    else elements.push(typeToJSON(element,null,context));
  }
  if(Object.keys(properties).length > 0 && elements.length == 0) {
    if(context != null && context.options != null && context.options.firstclassIntermediates) {
      let schema:any = { type:"object", properties:properties };

      if(required.length > 0) schema.required = required;

      let iname = storeIntermediate({ enclosedBy:context.enclosedBy, schema:schema });

      return { "$ref":`${context.options.docRoot}/${iname}` };
    }
    else {
      let schema:any = { type:"object", properties:properties };
 
      if(required.length > 0) schema.required = required;

      return schema;
    }
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

function tupleTypeToJSON(typeDesc:any,jsDoc:any,context?:any):Object {
   let tupleDesc = <ts.TupleTypeNode>typeDesc;
   let res = { allOf:[] };
   
   for(let i = 0;i < tupleDesc.elementTypes.length;i++) {
     let tupleElement = typeToJSON(tupleDesc.elementTypes[i],null,context);
     
     if(tupleElement != null) res.allOf.push(tupleElement);
   }
   return res;
}

function indexedAccessTypeToJSON(typeDesc:any,jsDoc:any,context?:any):Object {
  let iaDesc = <ts.IndexedAccessTypeNode>typeDesc;
  let indexType = checker.getTypeFromTypeNode(typeDesc.indexType);
  let objectType = checker.getTypeFromTypeNode(typeDesc.objectType);
  let index = checker.typeToString(indexType);
  let objs = checker.typeToString(objectType);
  let res;

  if(index == "ArrayBuffer" && objs == "ArrayBufferTypes") return { type:"string", hint:{ encoding:"base64" }};
  return typeToJSON(typeDesc.objectType,jsDoc,context);
}

function mappedTypeToJSON(typeDesc:any,jsDoc:any,context?:any):Object {
  let mapDesc = <ts.MappedTypeNode>typeDesc;
  let constraint = ts.getEffectiveConstraintOfTypeParameter(mapDesc.typeParameter);
  let res;

  //console.log("next: ",typeDesc.nextContainer.type);
  let type = checker.getTypeFromTypeNode(typeDesc.nextContainer.type);
  let types = checker.typeToString(type);
  //console.log("subordinate type: ",types);
  //console.log("constraint: ",constraint);
  //console.log("desc: ",typeDesc);
  
  return typeToJSON(typeDesc.nextContainer.type,jsDoc,context);
}

function conditionalTypeToJSON(typeDesc:any,jsDoc:any,context?:any):Object {
  let conditionalDesc = <ts.ConditionalTypeNode>typeDesc;
  let type = checker.getTypeFromTypeNode(typeDesc);

  ///console.log("conditional type = ",checker.typeToString(type));

  return typeToJSON(conditionalDesc.extendsType,jsDoc,context);
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
 * is inferred from the contents of the tag.  If the tag is not applicable to the
 * type, then an error is raised.  If the type is an array, the elemement type
 * is used where applicable.
 *
 * @param {any} schemaObject Reference to the schema component.
 * @param {any} tag The tag to apply.
 */
function applyTag(schemaObject: any,tag: any): void {
   if(tag == null) return;
   if(tag.title == "minimum" || tag.title == "maximum") {
     if(schemaObject.type == "array") applyTag(schemaObject.items,tag);
     else if(schemaObject.type != "number") throw(`@${tag.title} can only be applied to numbers`);
     applyValueTag(schemaObject,tag.title,parseInt(tag.description));
   }
   else if(tag.title == "minLength" || tag.title == "maxLength") {
     if(schemaObject.type == "array") applyTag(schemaObject.items,tag);
     else if(schemaObject.type != "string") throw(`@${tag.title} can only be applied to strings`);
     applyValueTag(schemaObject,tag.title,parseInt(tag.description));
   }
   else if(tag.title == "minItems" || tag.title == "maxItems")  {
     if(schemaObject.type != "array") throw(`@${tag.title} can only be applied to arrays`);
     applyValueTag(schemaObject,tag.title,parseInt(tag.description));
   }
   else if(tag.title == "format" || tag.title == "pattern") {
     if(schemaObject.type == "array") applyTag(schemaObject.items,tag);
     else if(schemaObject.type != "string") throw(`@format can only be applied to strings`);

     let value = tag.description.replace(/^{(.*)}$/,"$1");

     applyValueTag(schemaObject,tag.title,value);
   }
   else if(tag.title == "precision") {
     if(schemaObject.type == "array") applyTag(schemaObject.items,tag);
     else if(schemaObject.type != "number") throw(`@${tag.title} can only be applied to numbers`);
 
     schemaObject.precision = parseInt(tag.description);
   }
   else if(tag.title == "type") {
     if(schemaObject.type == "array") applyTag(schemaObject.items,tag);
     else if(tag.type.type == "NameExpression") applyTypenameTag(schemaObject,tag.type.name);
   }
}

function isTypeNode(desc:ts.TypeNode|ts.Symbol):boolean {
  try {
    (<ts.Node>desc).getSourceFile();
    return ts.isTypeNode(<ts.Node>desc);
  }
  catch(e) {
    return false;
  }
}

function getIndex(desc:ts.TypeNode|ts.Symbol) {
  if(desc == null) return null;
  
  let FQN;
  let index;

  if(isTypeNode(desc)) {
    let typeName = (<any>desc).typeName;

    try {
      let symbol1 = checker.getSymbolAtLocation(typeName);
      let symbol2;

      try { symbol2  = checker.getAliasedSymbol(symbol1); } catch(e) {}
      let local = tsany.getTextOfNode(typeName);

      index = local;
      if(symbol2 == null) FQN = checker.getFullyQualifiedName(symbol1);
      else FQN = checker.getFullyQualifiedName(symbol2);
    }
    catch(e) {
      if(typeName == null) return null;

      let type = checker.getTypeFromTypeNode(<any>desc);
      let symbol1 = (<any>desc).typeName.symbol;
      let symbol2;
    
      try { symbol2  = checker.getAliasedSymbol(symbol1); } catch(e) {}
      if(symbol2 == null) FQN = checker.getFullyQualifiedName(symbol1);
      else FQN = checker.getFullyQualifiedName(symbol2);
    }
  }
  else {
    let symbol2;

    try { symbol2  = checker.getAliasedSymbol(desc); } catch(e) {}

    if(symbol2 == null) FQN = checker.getFullyQualifiedName(desc);
    else FQN = checker.getFullyQualifiedName(symbol2);
  }
  if(FQN != "__type") {
    let components = FQN.split('"');

    if(components.length == 1) index = components[0];
    else index = { module:components[1], local:components[2].substring(1) };
  }
  return index;
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
function typeToJSON(typeDesc:any,jsDoc:any,context?:any):Object {
  let res;
  let type = checker.getTypeFromTypeNode(typeDesc);

  if(context != null && context.options == null) context = { options:context };
  if(typeDesc == null) return { type:"object" };
  if(typeDesc.constructor.name == 'NodeObject') {
    let unknown = false;
    let docRoot = "#/definitions";
    let schemaNamespace = "check";

    if(context != null && context.options != null && context.options.docRoot != null) docRoot = context.options.docRoot;
    if(context != null && context.options != null && context.options.schemaNamespace != null) schemaNamespace = context.options.schemaNamespace;
    switch(typeDesc.kind) {
      case ts.SyntaxKind.ArrayType: res = { type:"array", items:typeToJSON(typeDesc.elementType,null,context) }; break;
      case ts.SyntaxKind.TypeReference: 
      {
        let index = getIndex(typeDesc);

        if(index == "Array") {
          let arg = (<any>typeDesc).typeArguments[0];

          res = { type:"array", items:typeToJSON(arg,jsDoc,context) }
        }
        else if(index == "Date") {
          res = { oneOf:[{ type:"string", format:"date" }, { type:"string", format:"date-time" }], toDate:true, content:"flat" };
        }
        else {
          let name = index;

          if(typeof name != "string") {
            let sentry:any = symtabGet(index);

            if(sentry != null) name = sentry.schemaRefId;
            else name = null;
          }
          res = mapTypeDescName(docRoot,name);
          if(res != null && res['$ref'] != null && context != null && context.options != null && context.options.expandRefs) {
            let sentry:any = symtabGet(index);

            if(sentry == null) {
              let sc = getSourceContext(typeDesc);

              if(sc != null) {
                let _a:any = null;
                console.log(_a.b);
                throw(`undefined type reference ${index}\n file = ${sc.fileName} line = ${sc.lineNumber}`);
              }
              throw(`undefined type reference ${index}`);
            }
            res = sentry.schema[schemaNamespace];
          }
        }
      }
      break;
      case ts.SyntaxKind.PropertySignature:
      {
        let propertySignatureDesc:ts.PropertySignature = <ts.PropertySignature>typeDesc;

        if(propertySignatureDesc.type != null) res = typeToJSON(propertySignatureDesc.type,jsDoc,context);
        else res = null;
      }
      break;
      case ts.SyntaxKind.FunctionType: /* console.log(`ignoring function type ${checker.typeToString(type)}`); */ break;
      case ts.SyntaxKind.ConstructorType: /* console.log(`ignoring constructor type ${checker.typeToString(type)}`); */ break;
      case ts.SyntaxKind.TypeQuery: /* console.log(`ignoring type query ${checker.typeToString(type)}`); */ break;
      case ts.SyntaxKind.ParenthesizedType: /* console.log(`ignoring paranthesized type ${checker.typeToString(type)}`); */ break;
      case ts.SyntaxKind.IndexSignature: /* console.log(`ignoring index signature ${checker.typeToString(type)}`); */ break;
      case ts.SyntaxKind.TypeOperator: /* console.log(`ignoring type operator ${checker.typeToString(type)}`); */ break;
      case ts.SyntaxKind.UnionType: res = unionToJSON(typeDesc,jsDoc,context); break;
      case ts.SyntaxKind.LiteralType: res = literalToJSON(typeDesc,jsDoc); break;
      case ts.SyntaxKind.IntersectionType: res = intersectionToJSON(typeDesc,jsDoc,context); break;
      case ts.SyntaxKind.ConditionalType: res = conditionalTypeToJSON(typeDesc,jsDoc,context); break;
      case ts.SyntaxKind.TypeLiteral: res = typeliteralToJSON(typeDesc,jsDoc,context); break;
      case ts.SyntaxKind.MappedType: res = mappedTypeToJSON(typeDesc,jsDoc,context); break;
      case ts.SyntaxKind.TupleType: res = tupleTypeToJSON(typeDesc,jsDoc,context); break;
      case ts.SyntaxKind.IndexedAccessType: res = indexedAccessTypeToJSON(typeDesc,jsDoc,context); break;
      default: unknown = true; break;
    }
    if(unknown) {
      let sc = getSourceContext(typeDesc);

      if(sc != null)
        throw(`cannot convert unknown type (${typeDesc.kind}) to JSON\n file = ${sc.fileName} line = ${sc.lineNumber}`);
      throw(`cannot convert unknown type (${typeDesc.kind}) to JSON`); 
    }
  }
  else if(typeDesc.constructor.name == 'TokenObject') res = tokenObjectToJSON(typeDesc,jsDoc);
  else {
    let sc = getSourceContext(typeDesc);

    if(sc != null)
      throw(`unknown type (${typeDesc.constructor.name})\n file = ${sc.fileName} line = ${sc.lineNumber}`);
    throw(`unknown type (${typeDesc.constructor.name})`);
  }

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

export {
  checker,
  getIndex,
  mapTypeDescName,
  setChecker,
  symtab,
  symtabGet,
  symtabPut,
  typeToJSON
};
