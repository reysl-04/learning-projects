export interface RouteContext {
  request: Request;
  url: URL;
  params: Record<string, string>;
}

export type RouteHandler = (context: RouteContext) => Promise<Response> | Response;

interface Route {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

export interface RouteMatch {
  handler: RouteHandler;
  params: Record<string, string>;
}

/** Minimal path router: exact segments plus `:name` parameters. */
export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: RouteHandler): void {
    this.routes.push({
      method: method.toUpperCase(),
      segments: splitPath(path),
      handler,
    });
  }

  match(method: string, pathname: string): RouteMatch | null {
    const parts = splitPath(pathname);

    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;

      const params: Record<string, string> = {};
      let matched = true;

      for (let i = 0; i < route.segments.length; i += 1) {
        const segment = route.segments[i] as string;
        const part = parts[i] as string;

        if (segment.startsWith(":")) {
          try {
            params[segment.slice(1)] = decodeURIComponent(part);
          } catch {
            matched = false;
            break;
          }
        } else if (segment !== part) {
          matched = false;
          break;
        }
      }

      if (matched) return { handler: route.handler, params };
    }

    return null;
  }
}

function splitPath(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}
