import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import Handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';
import { Post } from '../models/Post';
import colors from 'colors';
export class EmailService {
	private sesClient: SESClient;
	private template: HandlebarsTemplateDelegate;
	private dev: boolean;
	constructor(dev: boolean) {
		this.dev = dev;
		this.sesClient = new SESClient({
			region: process.env.AWS_REGION || 'us-east-1',
			credentials: {
				accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
				secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
			},
		});
		const templatePath = path.join(__dirname, '../templates/email.hbs');
		const templateContent = fs.readFileSync(templatePath, 'utf-8');
		this.template = Handlebars.compile(templateContent);
	}

	async sendNewPosts(posts: Post[]): Promise<boolean> {
		if (posts.length === 0) return false;
		const html = this.template({ posts });
		const command = new SendEmailCommand({
			Source: process.env.EMAIL_SENDER,
			Destination: {
				ToAddresses: [process.env.EMAIL_RECIPIENT || ''],
			},
			Message: {
				Subject: {
					Data: 'New RSS Posts Update',
					Charset: 'UTF-8',
				},
				Body: {
					Html: {
						Data: html,
						Charset: 'UTF-8',
					},
				},
			},
		});
		if (this.dev) {
			console.log(colors.green('[dev] email:'), command);
			return true;
		}
		try {
			const response = await this.sesClient.send(command);
			return response.$metadata.httpStatusCode === 200;
		} catch (error) {
			console.error(colors.red('error sending email:'), error);
			throw error;
		}
	}
}
