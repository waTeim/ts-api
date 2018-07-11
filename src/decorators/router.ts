import 'reflect-metadata';

export default function router(prefix: string) {
  return function(target: any) {
    var original = target;

    var f:any = function(...args) {
      this.prefix = prefix;
      if(this.prefix.charAt(0) != '/') this.prefix = '/' + this.prefix;
      if(this.prefix.charAt(this.prefix.length - 1) == '/') this.prefix = this.prefix.substring(0,this.prefix.length - 1);
      return original.apply(this, args)
    }

    // copy prototype so intanceof operator still works
    f.prototype = original.prototype;

    // return new constructor (will override original)
    return f;
  };
}
