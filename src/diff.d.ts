declare module "diff" {
  export type Change = { value: string; count?: number; added?: boolean; removed?: boolean };
  export function diffLines(oldText: string, newText: string): Change[];
}
