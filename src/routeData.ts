import { defineRouteMiddleware } from '@astrojs/starlight/route-data';

// The whole site is the blog, so no page gets docs chrome: no left sidebar
// (and therefore no mobile menu button), no right-hand table of contents, and
// no docs-style prev/next footer pagination — blog posts get their own
// chronological prev/next links from starlight-blog instead.
export const onRequest = defineRouteMiddleware((context) => {
    const { starlightRoute } = context.locals;
    starlightRoute.hasSidebar = false;
    starlightRoute.toc = undefined;
    starlightRoute.pagination = { prev: undefined, next: undefined };
});
