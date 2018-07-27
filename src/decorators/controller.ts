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
      this.path = path;
      if(this.path.charAt(0) != '/') this.path = '/' + this.path;
      if(this.path.charAt(this.path.length - 1) == '/') this.path = this.path.substring(0,this.path.length - 1);
      return original.apply(this, args)
    }

    // copy prototype so intanceof operator still works
    f.prototype = original.prototype;

    // return new constructor (will override original)
    return f;
  };
}
