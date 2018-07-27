/**
 * General REST processing in case of an error
 */
declare function error(e: any, req: any, res: any, next: any): void;
/**
 * REST processing in case of endpoint success
 */
declare function success(obj: any, req: any, res: any, next: any): void;
declare const _default: {
    error: typeof error;
    success: typeof success;
};
export default _default;
