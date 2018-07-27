import 'reflect-metadata';
/**
 * Wrap the original router definition with a function
 * that will first save relevant infomation about the path
 * prefix in a member property before invoking the original
 * constructor
 */
export default function router(prefix: string): (target: any) => any;
