/**
 * A decorator for REST endpoints.  Use the typescript decorator system to
 * automatically apply typechecking.  Assume that the controller for which this
 * decorator applies to it's methods follows the form defined by ControllerBase
 * and itself hase been annotated by @controller.  If that is true, then a reference
 * to that controller class will be provided to an argument to this function.  Use
 * the controller reference to gain access to the function that defines the check as
 * well as the JSON schema to use as an argument.  Return a function that will first
 * perform that check, and if the check passes then execute the method on which this
 * decorator has been applied.  Otherwise throw an error.  Assume that the exception
 * will be caught appropriately -- it will because this function will be invoked in the
 * context of analogously renerated file __routes.js. Provide for the possibility
 * of a user defined function for error processing which can itself either return
 * a status code or throw an error.
 *
 * @param {any} target reference to containing class of the decorated method
 * @param {string} key the method name
 * @param {any} originalMethod reference to the decorated method
 * @param {Function} errorHandler A user defined error handler.
 */
export default function verb(target: any, key: string, originalMethod: any, errorHandler: Function): () => any;
