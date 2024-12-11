export interface Post {
  id?: number;
  title: string;
  link: string;
  content: string;
  pubDate: Date;
  feedId: number;
  sent: boolean;
}
