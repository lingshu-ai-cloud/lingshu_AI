import assert from 'node:assert/strict';
import {
  imageTypeForProductionMode,
  inferSocialImageProductionMode,
  productionModeFromDelivery,
} from './socialImageProductionMode';

assert.equal(inferSocialImageProductionMode({ mediaUrl: 'https://cdn.example/post.gif' }), 'gif');
assert.equal(inferSocialImageProductionMode({ thumbnail: 'cover.jpg', isAnimated: true }), 'gif');
assert.equal(inferSocialImageProductionMode({ thumbnail: 'https://cdn.example/post.jpg?format=gif&width=800' }), 'gif');
assert.equal(inferSocialImageProductionMode({ imageUrls: ['one.jpg', 'two.jpg'] }), 'carousel');
assert.equal(inferSocialImageProductionMode({ imageCount: 4, imageUrls: ['cover.jpg'] }), 'carousel');
assert.equal(inferSocialImageProductionMode({ imageUrls: ['one.jpg'] }), 'single');
assert.equal(imageTypeForProductionMode('gif'), 'gif_poster');
assert.equal(productionModeFromDelivery('carousel'), 'carousel');
