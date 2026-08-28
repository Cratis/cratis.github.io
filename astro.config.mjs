// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightBlog from 'starlight-blog';
import { authors } from './src/data/authors.mjs';

// starlight-blog wants only the fields it knows about; `signature` is used by
// src/components/Footer.astro for the per-post sign-off block.
const blogAuthors = Object.fromEntries(
    Object.entries(authors).map(([id, { name, title, url, picture }]) => [id, { name, title, url, picture }]),
);

// https://astro.build/config
export default defineConfig({
    site: 'https://blog.cratis.io',
    // The blog is the whole site — send the root straight to it. The topics
    // catalogue lives at /topics (see src/pages/topics/index.astro); keep the
    // intuitive /blog/tags URL working by redirecting it there.
    redirects: { '/': '/blog', '/blog/tags': '/topics' },
    integrations: [
        starlight({
            title: 'Cratis Blog',
            description:
                'The Cratis blog — essays and engineering explainers on event sourcing, CQRS, and building the open-source (MIT) Cratis stack: Chronicle, Arc, Components, and friends.',
            // Default social-sharing metadata for every page.
            head: [
                { tag: 'meta', attrs: { property: 'og:image', content: 'https://blog.cratis.io/favicon-512.png' } },
                { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary' } },
                { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://blog.cratis.io/favicon-512.png' } },
            ],
            logo: {
                light: './src/assets/cratis-mark-light.svg',
                dark: './src/assets/cratis-mark-dark.svg',
                alt: 'Cratis',
            },
            // Brand-font preloading without the cold-load swap reflow — same
            // technique as cratis.io (see the component for details).
            components: {
                Head: './src/components/Head.astro',
                // Appends the author signature block below each blog post.
                Footer: './src/components/Footer.astro',
                // Editorial masthead: logo + Blog/cratis.io links + social icons.
                Header: './src/components/Header.astro',
                // Renders the blog landing as a hero + large post cards;
                // delegates everything else to starlight-blog's override.
                MarkdownContent: './src/components/MarkdownContent.astro',
            },
            // Strips the remaining docs chrome (sidebar, ToC, docs pagination)
            // from every route — this site is a blog, not a docs site.
            routeMiddleware: './src/routeData.ts',
            favicon: '/favicon.ico',
            customCss: ['./src/styles/cratis.css'],
            tableOfContents: false,
            pagefind: false,
            // Same code-block look as cratis.io: vivid dark + soft light theme.
            expressiveCode: {
                themes: ['laserwave', 'slack-ochin'],
                styleOverrides: { borderRadius: '0.5rem' },
            },
            social: [
                { icon: 'github', label: 'GitHub', href: 'https://github.com/cratis' },
                { icon: 'discord', label: 'Discord', href: 'https://discord.gg/kt4AMpV8WV' },
                { icon: 'rss', label: 'RSS', href: '/blog/rss.xml' },
            ],
            plugins: [
                starlightBlog({
                    title: 'Blog',
                    authors: blogAuthors,
                    // RSS is generated at /blog/rss.xml because `site` is set.
                    metrics: { readingTime: true },
                    // The masthead has its own Blog link; skip the plugin's.
                    navigation: 'none',
                    // The landing lists every post as a card, so keep the
                    // built-in index on a single page (no /blog/2 pagination).
                    postCount: 100,
                }),
            ],
        }),
    ],
});
