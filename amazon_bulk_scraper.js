const axios = require('axios');
const cheerio = require('cheerio');
const randomUseragent = require('random-useragent');
const winston = require('winston');
const fs = require('fs');

const colors = {
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	reset: '\x1b[0m'
};

const logger = winston.createLogger({
	level: 'info',
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.json()
	),
	transports: [
		new winston.transports.File({ filename: 'scraper_error.log', level: 'error' }),
		new winston.transports.File({ filename: 'scraper_combined.log' })
	]
});

class BulkAmazonScraper {
	constructor() {
		this.productsPerCategory = 50;
		this.categories = [
			// Skin tone based
			"Skincare for Fair Skin",
			"Skincare for Medium Skin",
			"Skincare for Dark Skin",

			// Concerns
			"Acne Treatment",
			"Anti Aging Skincare",
			"Under Eye Treatment",
			"Dark Spot Treatment",
			"Hydrating Skincare",

			// Product types
			"Gentle Cleanser",
			"Moisturizer",
			"Sunscreen",
			"Hydrating Toner",
			"Brightening Serum",
			"Anti-Aging Cream",
			"Night Cream",
			"Eye Cream",
			"Spot Treatment",
			"Oil-Free Moisturizer",
			"Dark Spot Corrector",
			"Brightening Mask",
			"Rich Moisturizer",
			"Hydrating Serum",

			// Ingredient based
			"Niacinamide Skincare",
			"Vitamin C Skincare",
			"Zinc Oxide Skincare",
			"Hyaluronic Acid Skincare",
			"Peptides Skincare",
			"Vitamin E Skincare",
			"Kojic Acid Skincare",
			"Alpha Arbutin Skincare",
			"Retinol Products",
			"Coenzyme Q10 Skincare",
			"Caffeine Skincare",
			"Vitamin K Skincare",
			"Salicylic Acid Products",
			"Benzoyl Peroxide Products",
			"Tea Tree Oil Skincare",
			"Tranexamic Acid Skincare",
			"Ceramides Skincare",
			"Squalane Skincare"
		];

		this.results = {};
		this.seenProducts = new Set();

		this.totalCategories = this.categories.length;
		this.completedCategories = 0;
		this.currentCategoryProducts = 0;
	}

	drawProgressBar() {
		const overallPercent = this.completedCategories / this.totalCategories;
		const categoryPercent = this.currentCategoryProducts / this.productsPerCategory;

		const barLength = 30;
		const overallCompleted = Math.round(barLength * overallPercent);
		const categoryCompleted = Math.round(barLength * categoryPercent);

		const overallBar = '█'.repeat(overallCompleted) + '░'.repeat(barLength - overallCompleted);
		const categoryBar = '█'.repeat(categoryCompleted) + '░'.repeat(barLength - categoryCompleted);

		const currentCategory = this.categories[this.completedCategories] || 'Completed';

		process.stdout.write(`\r${colors.yellow}Overall: ${colors.reset}${overallBar} ${(overallPercent * 100).toFixed(1)}%`);
		process.stdout.write(`\n\r${colors.yellow}Current (${currentCategory}): ${colors.reset}${categoryBar} ${(categoryPercent * 100).toFixed(1)}%`);
		process.stdout.write(`\x1b[1A`); // Move cursor up one line
	}

	updateCategoryProgress(category, productsFound) {
		const percent = productsFound / this.productsPerCategory;
		const text = `${colors.magenta}[${category}]${colors.reset} (${productsFound}/${this.productsPerCategory} products)`;
		this.drawProgressBar(percent, text);
	}

	updateOverallProgress() {
		this.completedCategories++;
		const percent = this.completedCategories / this.totalCategories;
		console.log(`\n${colors.green}Completed ${this.completedCategories}/${this.totalCategories} categories${colors.reset}`);
		this.drawProgressBar(percent, `${colors.cyan}[Overall Progress]${colors.reset}`);
		console.log('\n');
	}

	getHeaders() {
		return {
			'User-Agent': randomUseragent.getRandom(),
			'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
			'Accept-Language': 'en-US,en;q=0.5',
			'Accept-Encoding': 'gzip, deflate, br',
			'Connection': 'keep-alive'
		};
	}

	extractProductDetails($, item) {
		try {
			const $item = $(item);

			const asin = $item.attr('data-asin') ||
				$item.attr('data-component-id') ||
				$item.find('[data-asin]').first().attr('data-asin');

			if (!asin) return null;

			const titleElem = $item.find('h2 span').first() ||
				$item.find('.a-text-normal').first() ||
				$item.find('.a-link-normal span').first();

			const priceElem = $item.find('.a-price .a-offscreen').first() ||
				$item.find('.a-price:not(.a-text-price) .a-offscreen').first();

			const ratingElem = $item.find('.a-icon-star-small .a-icon-alt').first() ||
				$item.find('.a-star-rating-text').first();

			const reviewsElem = $item.find('.a-size-base.s-underline-text').first() ||
				$item.find('[data-csa-c-type="widget"] .a-size-base').first();

			const imageElem = $item.find('img.s-image').first() ||
				$item.find('.s-image').first();

			if (!titleElem || !titleElem.text()) return null;

			const title = titleElem.text().trim();
			const productUrl = `https://www.amazon.com/dp/${asin}`;
			let price = null;
			let rating = null;
			let reviewsCount = null;
			const imageUrl = imageElem.attr('src');

			if (priceElem.length) {
				const priceText = priceElem.text().replace(/[^0-9.]/g, '');
				price = parseFloat(priceText);
			}

			if (ratingElem.length) {
				const ratingText = ratingElem.text().match(/\d+\.?\d*/);
				rating = ratingText ? parseFloat(ratingText[0]) : null;
			}

			if (reviewsElem.length) {
				const reviewsText = reviewsElem.text().replace(/[^0-9]/g, '');
				reviewsCount = parseInt(reviewsText) || null;
			}

			return {
				title,
				product_url: productUrl,
				price,
				rating,
				reviews_count: reviewsCount,
				image_url: imageUrl,
				asin
			};

		} catch (error) {
			logger.error(`Error extracting product details: ${error.message}`);
			return null;
		}
	}

	async searchCategory(category) {
		try {
			const products = [];
			let pageNumber = 1;
			const maxPages = 20;
			this.currentCategoryProducts = 0;

			while (products.length < this.productsPerCategory && pageNumber <= maxPages) {
				const searchQuery = encodeURIComponent(category);
				const url = `https://www.amazon.com/s?k=${searchQuery}&page=${pageNumber}`;

				await new Promise(resolve => setTimeout(resolve, 2000));

				const response = await axios.get(url, {
					headers: this.getHeaders(),
					timeout: 30000
				});

				const $ = cheerio.load(response.data);
				const productContainers = $('.s-result-item[data-component-type="s-search-result"]');

				const items = productContainers.toArray();
				for (const item of items) {
					const product = this.extractProductDetails($, item);
					if (product && !this.seenProducts.has(product.asin)) {
						products.push(product);
						this.seenProducts.add(product.asin);
						this.currentCategoryProducts = products.length;
						this.drawProgressBar();

						if (products.length >= this.productsPerCategory) break;
					}
				}

				const nextButton = $('.s-pagination-next:not(.s-pagination-disabled)');
				if (nextButton.length === 0) break;

				pageNumber++;
			}

			return products;

		} catch (error) {
			logger.error(`Error searching category ${category}: ${error.message}`);
			return [];
		}
	}

	async scrapeAllCategories() {
		console.clear();
		console.log(`${colors.green}Amazon Bulk Scraper${colors.reset}\n`);
		process.stdout.write('\n'); // Extra line for progress bar

		for (const category of this.categories) {
			this.results[category] = await this.searchCategory(category);
			this.completedCategories++;
			this.drawProgressBar();
			await new Promise(resolve => setTimeout(resolve, 5000));
		}

		this.saveResults();
		console.log('\n\n' + colors.green + 'Scraping completed!' + colors.reset);
	}

	saveResults() {
		const filename = 'amazon_products_db.json';
		fs.writeFileSync(
			filename,
			JSON.stringify(this.results, null, 2),
			'utf8'
		);
	}
}

async function main() {
	const scraper = new BulkAmazonScraper();
	try {
		await scraper.scrapeAllCategories();
	} catch (error) {
		logger.error('Scraping failed:', error);
		console.log('\n' + colors.red + 'Scraping failed: ' + error + colors.reset);
	}
}

main();
