import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    installId?: string;
    proxyToken?: string;
  }
}
