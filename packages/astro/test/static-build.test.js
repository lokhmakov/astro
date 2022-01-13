import { expect } from 'chai';
import cheerio from 'cheerio';
import { loadFixture } from './test-utils.js';

function addLeadingSlash(path) {
	return path.startsWith('/') ? path : '/' + path;
}

describe('Static build', () => {
	let fixture;

	before(async () => {
		fixture = await loadFixture({
			projectRoot: './fixtures/static-build/',
			renderers: ['@astrojs/renderer-preact'],
			buildOptions: {
				experimentalStaticBuild: true,
			},
		});
		await fixture.build();
	});

	it('Builds out .astro pags', async () => {
		const html = await fixture.readFile('/index.html');
		expect(html).to.be.a('string');
	});

	it('Builds out .md pages', async () => {
		const html = await fixture.readFile('/posts/thoughts/index.html');
		expect(html).to.be.a('string');
	});

	function createFindEvidence(expected) {
		return async function findEvidence(pathname) {
			const html = await fixture.readFile(pathname);
			const $ = cheerio.load(html);
			const links = $('link[rel=stylesheet]');
			for (const link of links) {
				const href = $(link).attr('href');
				const data = await fixture.readFile(addLeadingSlash(href));
				if (expected.test(data)) {
					return true;
				}
			}

			return false;
		};
	}

	describe('Shared CSS', () => {
		const findEvidence = createFindEvidence(/var\(--c\)/);

		it('Included on the index page', async () => {
			const found = await findEvidence('/index.html');
			expect(found).to.equal(true, 'Did not find shared CSS on this page');
		});

		it('Included on a md page', async () => {
			const found = await findEvidence('/posts/thoughts/index.html');
			expect(found).to.equal(true, 'Did not find shared CSS on this page');
		});
	});

	describe('CSS modules', () => {
		const findEvidence = createFindEvidence(/var\(--c-black\)/);

		it('Is included in the index CSS', async () => {
			const found = await findEvidence('/index.html');
			expect(found).to.equal(true, 'Did not find shared CSS module code');
		});
	});
});
