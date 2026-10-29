
const VAR = /\{([^{}]*)\}/g;

export function templateVars(template: string): string[] {
  return [...template.matchAll(VAR)].map((m) => m[1]);
}

export function isLevel1(template: string): boolean {
  return templateVars(template).every((v) => /^[A-Za-z0-9_]+$/.test(v));
}

export function expand(template: string, vars: Record<string, string | number | undefined>): string {
  if (!isLevel1(template)) throw new Error(`not a level-1 URI template: ${template}`);
  return template.replace(VAR, (_, name: string) => {
    const v = vars[name];
    return v === undefined ? '' : encodeURIComponent(String(v)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  });
}
