import Parser from 'rss-parser';
import { Post } from '../models/Post';
import axios from 'axios';
import { parseString } from 'xml2js';
import colors from 'colors';
export class RssService {
	private parser: Parser;
	private dev: boolean;
	constructor(dev: boolean) {
		this.dev = dev;
		this.parser = new Parser();
	}

	async fetchFeed(feedUrl: string, feedId: number): Promise<Post[]> {
		try {
			const feed = await this.parser.parseURL(feedUrl);
			const posts = feed.items.map(item => ({
				title: item.title || '',
				link: item.link || '',
				content: item.content || item.contentSnippet || '',
				pubDate: new Date(item.pubDate || Date.now()),
				feedId,
				sent: false,
			}));
			if (this.dev) {
				console.log(colors.yellow('[stop] 1st post only:'), posts[0]);
				return posts.slice(0, 1);
			}
			return posts;
		} catch (error) {
			console.error(colors.red('Error fetching RSS feed:'), error);
			return [];
		}
	}

	async validateFeedUrl(url: string): Promise<boolean> {
		try {
			const response = await axios.get(url);

			return new Promise((resolve, reject) => {
				parseString(response.data, (err: Error | null, result: any) => {
					if (err) {
						reject(new Error('Invalid RSS feed'));
					} else if (result.rss || result.feed) {
						resolve(true);
					} else {
						reject(new Error('Not a valid RSS feed'));
					}
				});
			});
		} catch (error) {
			throw new Error(`Failed to fetch feed: ${error instanceof Error ? error.message : error}`);
		}
	}
}
