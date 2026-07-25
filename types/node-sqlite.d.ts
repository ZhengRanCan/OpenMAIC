/** Node 22's node:sqlite API is used only by the Development Only F14 store. */
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path?: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...parameters: unknown[]): { changes: number };
      get(...parameters: unknown[]): Record<string, unknown> | undefined;
    };
  }
}
