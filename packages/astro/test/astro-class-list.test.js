import { expect } from 'chai';
import cheerio from 'cheerio';
import { loadFixture } from './test-utils.js';

let fixture;

before(async () => {
	fixture = await loadFixture({ projectRoot: './fixtures/astro-class-list/' });
	await fixture.build();
});

describe('Class List', async () => {
	it('Passes class:list attributes as expected to elements', async () => {
		const html = await fixture.readFile('/index.html');
		const $ = cheerio.load(html);

		expect($('[class="test control"]')).to.have.lengthOf(1);
		expect($('[class="test expression"]')).to.have.lengthOf(1);
		expect($('[class="test true"]')).to.have.lengthOf(1);
		expect($('[class="test truthy"]')).to.have.lengthOf(1);
		expect($('[class="test set"]')).to.have.lengthOf(1);
		expect($('[class="hello goodbye world friend"]')).to.have.lengthOf(1);

		expect($('.false, .noshow1, .noshow2, .noshow3, .noshow4')).to.have.lengthOf(0);
	});

	it('Passes class:list attributes as expected to components', async () => {
		const html = await fixture.readFile('/component/index.html');
		const $ = cheerio.load(html);

		expect($('[class="test control"]')).to.have.lengthOf(1);
		expect($('[class="test expression"]')).to.have.lengthOf(1);
		expect($('[class="test true"]')).to.have.lengthOf(1);
		expect($('[class="test truthy"]')).to.have.lengthOf(1);
		expect($('[class="test set"]')).to.have.lengthOf(1);
		expect($('[class="hello goodbye world friend"]')).to.have.lengthOf(1);
	});
});
