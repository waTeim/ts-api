import 'reflect-metadata';

/**
 * Wrap the original router definition with a function
 * that will first save relevant infomation about the path 
 * prefix in a member property before invoking the original 
 * constructor
 */
export default function router(prefix: string) {
  return function(target: any) {
    var original = target;

    var f:any = function(...args) {
      let newPrefix = prefix || '';
      if(newPrefix.charAt(0) != '/') newPrefix = '/' + newPrefix;
      if(newPrefix.charAt(newPrefix.length - 1) == '/') newPrefix = newPrefix.substring(0,newPrefix.length - 1);

      const result = new original(...args);
      result.prefix = newPrefix;
      return result;
    }

    // copy prototype so intanceof operator still works
    f.prototype = original.prototype;

    // return new constructor (will override original)
    return f;
  };
}
