import dotenv from 'dotenv'
import cron from 'node-cron'
import { DatabaseService } from './services/DatabaseService'
import { RssService } from './services/RssService'
import { EmailService } from './services/EmailService'
import readline from 'readline'
import colors from 'colors'
import path from 'path'

async function initializeDatabase() {
    const dbService = new DatabaseService(process.env.NODE_ENV === 'development')

    const isInitialized = await dbService.isDatabaseFullyInitialized()

    if (!isInitialized) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        })

        rl.question('Enter MySQL root username: ', (rootUser) => {
            rl.question('Enter MySQL root password: ', async (rootPassword) => {
                try {
                    await dbService.fullInitialize(rootUser, rootPassword)
                    console.log('Database initialized successfully!')
                } catch (error) {
                    console.error('Failed to initialize database:', error)
                } finally {
                    rl.close()
                }
            })
        })
    } else {
        await dbService.init()
    }
}

class App {
    private db: DatabaseService
    private rss: RssService
    private email: EmailService
    private dev: boolean
    constructor() {
        dotenv.config({ path: path.join(__dirname, '.env') })
        this.dev = process.env.DEV === '1' || process.env.DEV === 'true' || process.argv.includes('--dev')
        this.db = new DatabaseService(this.dev)
        this.rss = new RssService(this.dev)
        this.email = new EmailService(this.dev)
    }

    async init() {
        await initializeDatabase()
        await this.handleCLI()
        this.startCronJob()
        this.startInteractiveCLI()
    }

    private startCronJob() {
        cron.schedule('0 * * * *', this.processFeeds.bind(this))
        this.processFeeds()
    }

    private async handleCLI() {
        const args = process.argv.slice(2)

        for (let i = 0; i < args.length; i++) {
            const arg = args[i]

            switch (arg) {
                case '--list':
                    await this.listFeeds()
                    break

                case '--add':
                    const addUrl = args[i + 1]
                    if (!addUrl) {
                        console.error('Please provide a feed URL to add')
                        process.exit(1)
                    }
                    await this.addFeed(addUrl)
                    i++ // Skip the URL argument
                    break

                case '--remove':
                    const removeUrl = args[i + 1]
                    if (!removeUrl) {
                        console.error('Please provide a feed URL to remove')
                        process.exit(1)
                    }
                    await this.removeFeed(removeUrl)
                    i++ // Skip the URL argument
                    break

                default:
                    console.error('Invalid command. Use: --list, --add <url>, or --remove <url>')
                    process.exit(1)
            }
        }
    }

    private async addFeed(url: string) {
        try {
            await this.rss.validateFeedUrl(url)
            const feedId = await this.db.addFeed(url)
            console.log(colors.green(`Feed added successfully with ID: ${feedId}`))
        } catch (error) {
            console.error(colors.red('Error adding feed:'), error instanceof Error ? error.message : error)
            process.exit(1)
        }
    }

    private async removeFeed(url: string) {
        try {
            const removed = await this.db.removeFeed(url)
            if (removed) {
                console.log('Feed removed successfully')
            } else {
                console.log(colors.red('Feed not found'))
            }
        } catch (error) {
            console.error(colors.red('Error removing feed:'), error)
            process.exit(1)
        }
    }

    private async listFeeds() {
        try {
            const feeds = await this.db.listFeeds()
            if (feeds.length === 0) {
                console.log(colors.red('No feeds found'))
            } else {
                console.log(colors.blue('Feeds:'))
                feeds.forEach((feed) => {
                    console.log(`- ${feed.url}`)
                })
            }
        } catch (error) {
            console.error(colors.red('Error listing feeds:'), error)
            process.exit(1)
        }
    }

    private async processFeeds() {
        try {
            const feeds = await this.db.listFeeds()
            for (const feed of feeds) {
                if (feed.id === undefined) {
                    console.warn(colors.yellow(`Skipping feed with undefined ID: ${feed.url}`))
                    continue
                }
                const posts = await this.rss.fetchFeed(feed.url, feed.id)
                await this.db.saveNewPosts(posts)
                if (this.dev) {
                    console.log(colors.yellow('[stop] 1st feed:'), feed)
                    break
                }
            }
            const unsentPosts = await this.db.getUnsentPosts()
            if (unsentPosts.length > 0) {
                await this.email.sendNewPosts(unsentPosts)
                await this.db.markPostsAsSent(unsentPosts.map((post) => post.id!))
            }
        } catch (error) {
            console.error(colors.red('Error processing feeds:'), error)
        }
    }

    private startInteractiveCLI() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: colors.cyan('RSS Feed Manager') + ' ➤ ',
        })

        // Display welcome message
        console.log('\n' + colors.cyan.bold('=== RSS Feed Manager ==='))
        console.log(`Type ${colors.yellow('help')} to see available commands\n`)

        rl.prompt()

        rl.on('line', async (line) => {
            const [command, ...args] = line.trim().split(' ')

            try {
                switch (command) {
                    case 'add':
                        if (args.length === 0) {
                            console.error(colors.red('✖ Please provide a feed URL to add'))
                        } else {
                            await this.addFeed(args[0])
                        }
                        break
                    case 'rm':
                    case 'remove':
                        if (args.length === 0) {
                            console.error(colors.red('✖ Please provide a feed URL to remove'))
                        } else {
                            await this.removeFeed(args[0])
                        }
                        break
                    case 'list':
                        await this.listFeeds()
                        break
                    case 'exit':
                        rl.close()
                        break
                    case 'help':
                        console.log(colors.cyan.bold('Available Commands:'))
                        console.log(`  ${colors.green('➕ add <url>')}     - Add a new RSS feed URL to monitor`)
                        console.log(`  ${colors.red('➖ rm <url>')}      - Remove an RSS feed URL from monitoring`)
                        console.log(`  ${colors.red('➖ remove <url>')}  - Same as rm command`)
                        console.log(`  ${colors.blue('📋 list')}          - Show all monitored RSS feeds`)
                        console.log(`  ${colors.yellow('❓ help')}          - Show this help message`)
                        console.log(`  ${colors.magenta('👋 exit')}          - Exit the RSS Feed Manager`)
                        console.log('\n' + colors.cyan.bold('Examples:'))
                        console.log('  add https://example.com/feed.xml')
                        console.log('  rm https://example.com/feed.xml')
                        console.log('  list')
                        break
                    default:
                        console.log(colors.red('✖ Invalid command.') + ' Use: add <url>, rm <url>, list, or exit')
                }
            } catch (error) {
                console.error(colors.red('✖ Error:'), error)
            }

            rl.prompt()
        }).on('close', () => {
            console.log('\n' + colors.cyan('👋 Goodbye! Exiting RSS Feed Manager'))
            process.exit(0)
        })
    }
}

const app = new App()
app.init().catch(console.error)
