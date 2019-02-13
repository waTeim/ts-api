import * as ts from "typescript";
const tsany = ts as any;

/**
 * Interface for recording the elements of a method parameter list
 */
export interface TypedId {
  id: string,
  type: Object,
  required: boolean,
  decorators: any[]
};

/**
 * Simple object for holding the processing of a path; principally for
 * the result of url param detection and component assignement.
 */
export interface PathDecomposition {
  pathComponents:string[],
  urlParams:Object
}

/**
 * Interface for collection of relevant information about class methods
 * annotated with REST verb decorators (e.g. @get, @post, etc).
 *
 */
export interface DecoratedFunction {
  name: string,
  index: string | Object,
  classRef: string,
  comment: string,
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
export interface Controller {
  args: any[],
  classRef: string,
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
export interface Router {
  args: any[],
  className: string,
  fileName: string,
  comment: string,
  decomposition: PathDecomposition
}
