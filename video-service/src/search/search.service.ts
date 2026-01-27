import { Injectable, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from '@elastic/elasticsearch';
import { Video, VideoStatus } from '../entities/video.entity';

export interface VideoDocument {
  id: string;
  userId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  hlsUrl: string;
  aspectRatio: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  createdAt: Date;
}

export interface UserDocument {
  id: string;
  username: string;
  bio: string;
  avatar: string;
  followerCount: number;
  createdAt: Date;
}

@Injectable()
export class SearchService implements OnModuleInit, OnModuleDestroy {
  private client: Client;
  private isConnected = false;
  private readonly VIDEO_INDEX = 'videos';
  private readonly USER_INDEX = 'users';

  constructor(
    private configService: ConfigService,
    @InjectRepository(Video)
    private videoRepository: Repository<Video>,
  ) {
    const esNode = this.configService.get<string>('ELASTICSEARCH_NODE') || 'http://localhost:9200';
    
    this.client = new Client({
      node: esNode,
      maxRetries: 5,
      requestTimeout: 60000,
    });
  }

  async onModuleInit() {
    await this.connect();
    await this.createIndices();
    // Auto-sync videos if index is empty
    await this.autoSyncVideosIfEmpty();;
  }

  async onModuleDestroy() {
    await this.client.close();
  }

  private async connect(): Promise<void> {
    try {
      const health = await this.client.cluster.health({});
      console.log('✅ Elasticsearch connected:', health.status);
      this.isConnected = true;
    } catch (error) {
      console.warn('⚠️ Elasticsearch not available, falling back to SQL search:', error.message);
      this.isConnected = false;
    }
  }

  private async createIndices(): Promise<void> {
    if (!this.isConnected) return;

    try {
      // Create videos index
      const videoIndexExists = await this.client.indices.exists({ index: this.VIDEO_INDEX });
      if (!videoIndexExists) {
        await this.client.indices.create({
          index: this.VIDEO_INDEX,
          settings: {
            number_of_shards: 1,
            number_of_replicas: 0,
            analysis: {
              analyzer: {
                vietnamese_analyzer: {
                  type: 'custom',
                  tokenizer: 'standard',
                  filter: ['lowercase', 'asciifolding'],
                },
              },
            },
          },
          mappings: {
            properties: {
              id: { type: 'keyword' },
              userId: { type: 'keyword' },
              title: { 
                type: 'text', 
                analyzer: 'vietnamese_analyzer',
                fields: {
                  keyword: { type: 'keyword' }
                }
              },
              description: { 
                type: 'text', 
                analyzer: 'vietnamese_analyzer' 
              },
              thumbnailUrl: { type: 'keyword' },
              hlsUrl: { type: 'keyword' },
              aspectRatio: { type: 'keyword' },
              viewCount: { type: 'integer' },
              likeCount: { type: 'integer' },
              commentCount: { type: 'integer' },
              createdAt: { type: 'date' },
            },
          },
        });
        console.log('✅ Videos index created');
      }

      // Create users index
      const userIndexExists = await this.client.indices.exists({ index: this.USER_INDEX });
      if (!userIndexExists) {
        await this.client.indices.create({
          index: this.USER_INDEX,
          settings: {
            number_of_shards: 1,
            number_of_replicas: 0,
            analysis: {
              analyzer: {
                vietnamese_analyzer: {
                  type: 'custom',
                  tokenizer: 'standard',
                  filter: ['lowercase', 'asciifolding'],
                },
              },
            },
          },
          mappings: {
            properties: {
              id: { type: 'keyword' },
              username: { 
                type: 'text', 
                analyzer: 'vietnamese_analyzer',
                fields: {
                  keyword: { type: 'keyword' },
                  autocomplete: {
                    type: 'text',
                    analyzer: 'vietnamese_analyzer',
                  }
                }
              },
              bio: { 
                type: 'text', 
                analyzer: 'vietnamese_analyzer' 
              },
              avatar: { type: 'keyword' },
              followerCount: { type: 'integer' },
              createdAt: { type: 'date' },
            },
          },
        });
        console.log('✅ Users index created');
      }
    } catch (error) {
      console.error('❌ Error creating indices:', error.message);
    }
  }

  // Auto-sync videos from database if Elasticsearch index is empty
  private async autoSyncVideosIfEmpty(): Promise<void> {
    if (!this.isConnected) return;

    try {
      // Check if videos index has any documents
      const countResult = await this.client.count({ index: this.VIDEO_INDEX });
      const docCount = countResult.count;
      
      console.log(`📊 Videos index has ${docCount} documents`);
      
      if (docCount === 0) {
        console.log('📦 Auto-syncing videos from database to Elasticsearch...');
        
        // Get all ready videos from database
        const videos = await this.videoRepository.find({
          where: { status: VideoStatus.READY, isHidden: false },
        });

        if (videos.length === 0) {
          console.log('ℹ️ No ready videos in database to sync');
          return;
        }

        // Transform to Elasticsearch documents
        const documents: VideoDocument[] = videos.map((video) => ({
          id: video.id,
          userId: video.userId,
          title: video.title || '',
          description: video.description || '',
          thumbnailUrl: video.thumbnailUrl || '',
          hlsUrl: video.hlsUrl || '',
          aspectRatio: video.aspectRatio || '9:16',
          viewCount: video.viewCount || 0,
          likeCount: 0,
          commentCount: 0,
          createdAt: video.createdAt,
        }));

        // Bulk index
        await this.bulkIndexVideos(documents);
        console.log(`✅ Auto-synced ${videos.length} videos to Elasticsearch`);
      }
    } catch (error) {
      console.error('❌ Error auto-syncing videos:', error.message);
    }
  }

  // Check if Elasticsearch is available
  isAvailable(): boolean {
    return this.isConnected;
  }

  // Index a video document
  async indexVideo(video: VideoDocument): Promise<void> {
    if (!this.isConnected) return;

    try {
      await this.client.index({
        index: this.VIDEO_INDEX,
        id: video.id,
        document: video,
      });
      console.log(`📝 Indexed video: ${video.id}`);
    } catch (error) {
      console.error('❌ Error indexing video:', error.message);
    }
  }

  // Index a user document
  async indexUser(user: UserDocument): Promise<void> {
    if (!this.isConnected) return;

    try {
      await this.client.index({
        index: this.USER_INDEX,
        id: user.id,
        document: user,
      });
      console.log(`📝 Indexed user: ${user.id}`);
    } catch (error) {
      console.error('❌ Error indexing user:', error.message);
    }
  }

  // Delete a video from index
  async deleteVideo(videoId: string): Promise<void> {
    if (!this.isConnected) return;

    try {
      await this.client.delete({
        index: this.VIDEO_INDEX,
        id: videoId,
      });
      console.log(`🗑️ Deleted video from index: ${videoId}`);
    } catch (error) {
      console.error('❌ Error deleting video from index:', error.message);
    }
  }

  // Delete a user from index
  async deleteUser(userId: string): Promise<void> {
    if (!this.isConnected) return;

    try {
      await this.client.delete({
        index: this.USER_INDEX,
        id: userId,
      });
      console.log(`🗑️ Deleted user from index: ${userId}`);
    } catch (error) {
      console.error('❌ Error deleting user from index:', error.message);
    }
  }

  // Search videos with Elasticsearch
  async searchVideos(query: string, limit: number = 50): Promise<VideoDocument[]> {
    if (!this.isConnected) {
      return [];
    }

    try {
      const result = await this.client.search<VideoDocument>({
        index: this.VIDEO_INDEX,
        size: limit,
        query: {
          bool: {
            should: [
              {
                multi_match: {
                  query: query,
                  fields: ['title^3', 'description'],
                  type: 'best_fields',
                  fuzziness: 'AUTO',
                },
              },
              {
                match_phrase_prefix: {
                  title: {
                    query: query,
                    boost: 2,
                  },
                },
              },
            ],
            minimum_should_match: 1,
          },
        },
        sort: [
          { _score: { order: 'desc' } },
          { viewCount: { order: 'desc' } },
          { createdAt: { order: 'desc' } },
        ],
      });

      const hits = result.hits.hits;
      console.log(`🔍 Elasticsearch found ${hits.length} videos for query: "${query}"`);

      return hits.map((hit) => hit._source as VideoDocument);
    } catch (error) {
      console.error('❌ Error searching videos in Elasticsearch:', error.message);
      return [];
    }
  }

  // Search users with Elasticsearch
  async searchUsers(query: string, limit: number = 50): Promise<UserDocument[]> {
    if (!this.isConnected) {
      return [];
    }

    try {
      const result = await this.client.search<UserDocument>({
        index: this.USER_INDEX,
        size: limit,
        query: {
          bool: {
            should: [
              {
                match: {
                  username: {
                    query: query,
                    fuzziness: 'AUTO',
                    boost: 3,
                  },
                },
              },
              {
                prefix: {
                  'username.keyword': {
                    value: query.toLowerCase(),
                    boost: 2,
                  },
                },
              },
              {
                match: {
                  bio: {
                    query: query,
                    fuzziness: 'AUTO',
                  },
                },
              },
            ],
            minimum_should_match: 1,
          },
        },
        sort: [
          { _score: { order: 'desc' } },
          { followerCount: { order: 'desc' } },
        ],
      });

      const hits = result.hits.hits;
      console.log(`🔍 Elasticsearch found ${hits.length} users for query: "${query}"`);

      return hits.map((hit) => hit._source as UserDocument);
    } catch (error) {
      console.error('❌ Error searching users in Elasticsearch:', error.message);
      return [];
    }
  }

  // Bulk index videos (for initial sync)
  async bulkIndexVideos(videos: VideoDocument[]): Promise<void> {
    if (!this.isConnected || videos.length === 0) return;

    try {
      const operations = videos.flatMap((video) => [
        { index: { _index: this.VIDEO_INDEX, _id: video.id } },
        video,
      ]);

      const result = await this.client.bulk({ operations, refresh: true });
      
      if (result.errors) {
        console.error('❌ Some videos failed to index');
      } else {
        console.log(`✅ Bulk indexed ${videos.length} videos`);
      }
    } catch (error) {
      console.error('❌ Error bulk indexing videos:', error.message);
    }
  }

  // Bulk index users (for initial sync)
  async bulkIndexUsers(users: UserDocument[]): Promise<void> {
    if (!this.isConnected || users.length === 0) return;

    try {
      const operations = users.flatMap((user) => [
        { index: { _index: this.USER_INDEX, _id: user.id } },
        user,
      ]);

      const result = await this.client.bulk({ operations, refresh: true });
      
      if (result.errors) {
        console.error('❌ Some users failed to index');
      } else {
        console.log(`✅ Bulk indexed ${users.length} users`);
      }
    } catch (error) {
      console.error('❌ Error bulk indexing users:', error.message);
    }
  }

  // Update video counts (for real-time updates)
  async updateVideoCounts(videoId: string, counts: Partial<Pick<VideoDocument, 'viewCount' | 'likeCount' | 'commentCount'>>): Promise<void> {
    if (!this.isConnected) return;

    try {
      await this.client.update({
        index: this.VIDEO_INDEX,
        id: videoId,
        doc: counts,
      });
    } catch (error) {
      // Ignore if document doesn't exist
      if (error.meta?.statusCode !== 404) {
        console.error('❌ Error updating video counts:', error.message);
      }
    }
  }
}
