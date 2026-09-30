import sharp from 'sharp';

await sharp('public/logo.jpg').resize(32, 32).png().toFile('public/favicon-32.png');
await sharp('public/logo.jpg').resize(16, 16).png().toFile('public/favicon-16.png');
await sharp('public/logo.jpg').resize(180, 180).png().toFile('public/apple-touch-icon.png');
await sharp('public/logo.jpg').resize(192, 192).png().toFile('public/icon-192.png');
console.log('done');
