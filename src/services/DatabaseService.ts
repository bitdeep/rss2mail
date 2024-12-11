import { init as mysqlInit, sql } from '../mysql'
import { Post } from '../models/Post'
import { Feed } from '../models/Feed'
import colors from 'colors'
import { OkPacket } from 'mysql2'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'

export class DatabaseService {
    private dev: boolean
    private envPath: string

    constructor(dev: boolean) {
        this.dev = dev
        this.envPath = path.resolve(__dirname, '../.env')
        dotenv.config()
    }

    async init() {
        await mysqlInit()
        await this.createTables()
    }

    async isDatabaseFullyInitialized(): Promise<boolean> {
        try {
            const [feedsCheck] = await sql(`
                SHOW COLUMNS FROM feeds 
                WHERE Field IN ('id', 'url', 'url_hash', 'lastChecked')
            `)

            const [postsCheck] = await sql(`
                SHOW COLUMNS FROM posts 
                WHERE Field IN ('id', 'title', 'link', 'hash', 'content', 'pubDate', 'feedId', 'sent')
            `)

            return feedsCheck.length === 4 && postsCheck.length === 8
        } catch (error) {
            console.error(colors.red('Error checking database initialization:'), error)
            return false
        }
    }

    async fullInitialize(rootUser: string, rootPassword: string): Promise<void> {
        try {
            await sql(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`)

            const appUser = 'app_user'
            const appPassword = this.generateRandomPassword()

            await sql(`
                CREATE USER IF NOT EXISTS '${appUser}'@'localhost' IDENTIFIED BY '${appPassword}'
            `)
            await sql(`
                GRANT ALL PRIVILEGES ON ${process.env.DB_NAME}.* TO '${appUser}'@'localhost'
            `)
            await sql('FLUSH PRIVILEGES')

            this.updateEnvFile({
                DB_HOST: 'localhost',
                DB_USER: appUser,
                DB_PASSWORD: appPassword,
                DB_NAME: process.env.DB_NAME || 'rss_feed_db',
            })

            await this.createTables()

            console.log(colors.green('Database fully initialized successfully!'))
        } catch (error) {
            console.error(colors.red('Error during full database initialization:'), error)
            throw error
        }
    }

    private generateRandomPassword(length: number = 16): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+'
        return Array.from(crypto.getRandomValues(new Uint32Array(length)))
            .map((x) => chars[x % chars.length])
            .join('')
    }

    private updateEnvFile(updates: Record<string, string>) {
        let envContent = fs.existsSync(this.envPath) ? fs.readFileSync(this.envPath, 'utf8') : ''

        for (const [key, value] of Object.entries(updates)) {
            const regex = new RegExp(`^${key}=.*$`, 'm')
            if (envContent.match(regex)) {
                envContent = envContent.replace(regex, `${key}=${value}`)
            } else {
                envContent += `\n${key}=${value}`
            }
        }

        fs.writeFileSync(this.envPath, envContent)
    }

    private async createTables() {
        await sql(`
			CREATE TABLE IF NOT EXISTS feeds (
				id INT PRIMARY KEY AUTO_INCREMENT,
				url TEXT NOT NULL,
				url_hash VARCHAR(64) NOT NULL UNIQUE,
				lastChecked DATETIME,
				INDEX idx_last_checked (lastChecked),
				UNIQUE INDEX idx_url_hash (url_hash)
			)
		`)

        await sql(`
			CREATE TRIGGER IF NOT EXISTS hash_url_before_insert 
			BEFORE INSERT ON feeds
			FOR EACH ROW
			BEGIN
				SET NEW.url_hash = SHA2(NEW.url, 256);
			END
		`)

        await sql(`
			CREATE TABLE IF NOT EXISTS posts (
				id INT PRIMARY KEY AUTO_INCREMENT,
				title VARCHAR(1024) NOT NULL,
				link text NOT NULL UNIQUE,
				hash VARCHAR(64) NOT NULL UNIQUE,
				content TEXT,
				pubDate DATETIME,
				feedId INT,
				sent BOOLEAN DEFAULT FALSE,
				FOREIGN KEY (feedId) REFERENCES feeds(id) ON DELETE CASCADE,
				UNIQUE INDEX idx_post_hash (hash),
				INDEX idx_feed_id (feedId),
				INDEX idx_pub_date (pubDate),
				INDEX idx_sent_status (sent),
				INDEX idx_title (title)
			)
		`)

        await sql(`
			CREATE TRIGGER IF NOT EXISTS hash_post_before_insert 
			BEFORE INSERT ON posts
			FOR EACH ROW
				BEGIN
					SET NEW.hash = SHA2(NEW.title, 256);
				END
		`)
    }

    async saveNewPosts(posts: Post[]): Promise<void> {
        for (const post of posts) {
            try {
                await sql(
                    `
					INSERT IGNORE INTO posts 
					SET 
						title = ?, 
						link = ?, 
						content = ?, 
						pubDate = ?, 
						feedId = ?, 
						sent = FALSE
				`,
                    [post.title, post.link, post.content, post.pubDate, post.feedId],
                )
            } catch (error) {
                console.error(colors.red('Error saving post:'), error)
            }
        }
    }

    async getUnsentPosts(): Promise<Post[]> {
        const [rows] = (await sql('SELECT * FROM posts WHERE sent = FALSE ORDER BY pubDate DESC')) || [[]]

        const posts = rows as Post[]

        if (this.dev) {
            console.log(colors.yellow('[stop] 1st post unset only:'), posts[0])
            return posts.slice(0, 1)
        }
        return posts || []
    }

    async addFeed(url: string): Promise<number> {
        try {
            const [result] =
                (await sql(
                    `
				INSERT INTO feeds 
				SET url = ?
			`,
                    [url],
                )) || []
            const id = (result as OkPacket).insertId
            if (this.dev) {
                console.log(colors.green('Feed added:'), url, result, id)
            }
            return id
        } catch (error) {
            console.error(colors.red('Error adding feed:'), error)
            throw error
        }
    }

    async removeFeed(url: string): Promise<boolean> {
        try {
            const [result] =
                (await sql(
                    `
				DELETE FROM feeds 
				WHERE url = ?
			`,
                    [url],
                )) || []
            return (result as OkPacket).affectedRows > 0
        } catch (error) {
            console.error(colors.red('Error removing feed:'), error)
            throw error
        }
    }

    async listFeeds(): Promise<Feed[]> {
        try {
            const [feeds] = (await sql('SELECT id, url, lastChecked FROM feeds')) || [[]]
            return feeds as Feed[]
        } catch (error) {
            console.error(colors.red('Error listing feeds:'), error)
            throw error
        }
    }

    async markPostsAsSent(posts: number[]): Promise<void> {
        if (posts.length === 0) return
        await sql(`
			UPDATE posts SET sent = TRUE WHERE id IN (${posts.join(',')})
		`)
    }
}
