import 'reflect-metadata';

export default function router(prefix: string) {
  return function(target:any) { target.prefix = prefix; console.log("setting target.prefix = ",prefix); }
}

