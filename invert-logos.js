const { Jimp } = require('jimp');

async function invertLogo(inputPath, outputPath) {
  try {
    const image = await Jimp.read(inputPath);
    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function(x, y, idx) {
      this.bitmap.data[idx + 0] = 255 - this.bitmap.data[idx + 0]; // R
      this.bitmap.data[idx + 1] = 255 - this.bitmap.data[idx + 1]; // G
      this.bitmap.data[idx + 2] = 255 - this.bitmap.data[idx + 2]; // B
    });
    await image.write(outputPath);
    console.log(`Successfully inverted ${inputPath} to ${outputPath}`);
  } catch (err) {
    console.error(`Error processing ${inputPath}:`, err);
  }
}

async function main() {
  await invertLogo(
    './apps/consumer-app/assets/logo-full.png',
    './apps/consumer-app/assets/logo-full-dark.png'
  );
  await invertLogo(
    './apps/consumer-app/assets/logo-icon.png',
    './apps/consumer-app/assets/logo-icon-dark.png'
  );
}

main();
