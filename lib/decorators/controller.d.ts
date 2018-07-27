import 'reflect-metadata';
/**
 * Wrap the original controller definition with a function
 * that will first save relevant infomation about the path
 * in a member property before invoking the original
 * constructor
 */
export default function controller(path: string): (target: any) => any;
