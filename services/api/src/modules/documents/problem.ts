export class Problem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: {
      readonly field?: string;
      readonly fields?: readonly string[];
    } = {},
  ) {
    super(code);
  }
  body(): {
    type: string;
    title: string;
    status: number;
    code: string;
    field?: string;
    fields?: readonly string[];
  } {
    return {
      type: "about:blank",
      title: this.code,
      status: this.status,
      code: this.code,
      ...this.extra,
    };
  }
}
export function problemResponse(problem: Problem): Response {
  return new Response(JSON.stringify(problem.body()), {
    status: problem.status,
    headers: {
      "Content-Type": "application/problem+json",
      "Cache-Control": "no-store",
    },
  });
}
