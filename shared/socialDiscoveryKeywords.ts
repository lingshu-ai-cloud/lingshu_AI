import type { SocialCrawlStrategy } from './contracts/socialContentWorkflow';

/** The preview and workers must consume exactly the same enabled queries. */
export function discoveryKeywords(strategy: SocialCrawlStrategy): string[] {
  const graph = strategy.keywordSet.graph;
  return [...new Set([
    ...graph.discoverySeeds.filter(seed => seed.enabled).flatMap(seed => seed.queryVariants),
    ...graph.sceneClusters.filter(scene => scene.status === 'approved' || scene.status === 'watching').flatMap(scene => scene.queryVariants),
    ...graph.evidenceQueries.flatMap(query => query.queryVariants),
  ].map(value => value.trim()).filter(Boolean))];
}
