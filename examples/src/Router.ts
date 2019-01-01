import { RouterBase, router } from 'ts-api';

/**
 * Example TS-API Service
 */
@router('/api')
export default class Router extends RouterBase {
  constructor(app: any) {
    super(app);
    require('./__routes')(this);
  }
}

