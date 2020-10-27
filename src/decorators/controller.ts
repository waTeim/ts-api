import 'reflect-metadata';

/**
 * Wrap the original controller definition with a function
 * that will first save relevant infomation about the path
 * in a member property before invoking the original 
 * constructor
 */
export default function controller(path: string) {
  return function(target: any) {
    var original = target;

    var f:any = function(...args) {
      let newPath = path;
      if(newPath.charAt(0) != '/') newPath = '/' + newPath;
      if(newPath.charAt(newPath.length - 1) == '/') newPath = newPath.substring(0,newPath.length - 1);

      const result = new original(...args);
      result.path = newPath;
      return result;
    }

    // copy prototype so intanceof operator still works
    f.prototype = original.prototype;

    // return new constructor (will override original)
    return f;
  };
}
