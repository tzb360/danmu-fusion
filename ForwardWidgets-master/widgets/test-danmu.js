// 模拟 iOS JavaScriptBridge 的 Widget 对象 - 模拟 iOS 环境
global.Widget = {
  http: {
    get: async (url, options) => {
      console.log(`[iOS模拟] HTTP GET: ${url}`);
      
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            ...options.headers,
            'User-Agent': 'ForwardWidgets/1.0.0'
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        if (verbose) {
          console.log(`[iOS模拟] API响应:`, JSON.stringify(data, null, 2));
        }
        
        // 模拟 iOS 环境：返回 { data: ... } 结构
        return {
          data: data,
          status: response.status,
          headers: Object.fromEntries(response.headers.entries())
        };
        
      } catch (error) {
        console.error(`[iOS模拟] 请求失败:`, error.message);
        throw error;
      }
    }
  }
};

// 模拟 WidgetMetadata
global.WidgetMetadata = {
  id: "forward.danmu",
  title: "弹幕",
  version: "1.0.0",
  description: "获取弹幕数据"
};

// 配置变量
const verbose = false; // 设置为 true 时打印详细结果
const server = 'https://api.dandanplay.net'; // API 服务器地址

// 加载 danmu.js 模块
const fs = require('fs');
const danmuCode = fs.readFileSync('./danmu.js', 'utf8');
eval(danmuCode);

async function testNewFlow() {
  console.log('=== 测试新的弹幕获取链路 ===\n');
  console.log(`[配置] 服务器: ${server}`);
  console.log(`[配置] 详细输出: ${verbose ? '开启' : '关闭'}\n`);
  
  try {
    // 测试1: 搜索"胆大党第二季"
    console.log('🔍 测试1: 搜索"胆大党第二季"');
    const result1 = await searchDanmu({
      title: '胆大党',
      season: '2',
      type: 'tv',
      server: server
    });
    if (verbose) {
      console.log('✅ 搜索结果:', JSON.stringify(result1, null, 2));
    } else {
      console.log(`✅ 搜索结果: 找到 ${result1.animes ? result1.animes.length : 0} 个动漫`);
    }
    
    if (result1.animes && result1.animes.length > 0) {
      const anime = result1.animes[0];
      console.log(`📺 找到动漫: ${anime.animeTitle} (ID: ${anime.animeId})`);
      
      // 通过 getDetailById 获取 episodes
      console.log('🎬 获取 episodes...');
      const episodes = await getDetailById({
        animeId: anime.animeId,
        server: server
      });
      if (verbose) {
        console.log('✅ Episodes:', JSON.stringify(episodes, null, 2));
      } else {
        console.log(`✅ Episodes: 获取到 ${episodes ? episodes.length : 0} 集`);
      }
      
      if (episodes && episodes.length > 0) {
        const episode = episodes[0];
        console.log(`🎬 测试第1集: ${episode.episodeTitle} (ID: ${episode.episodeId})`);
        
        // 获取弹幕评论
        console.log('💬 获取弹幕评论...');
        const comments = await getCommentsById({
          commentId: episode.episodeId,
          server: server
        });
        if (verbose) {
          console.log('✅ 弹幕评论:', JSON.stringify(comments, null, 2));
        } else {
          console.log(`✅ 弹幕评论: 获取到 ${comments && comments.comments ? comments.comments.length : 0} 条弹幕`);
        }
      }
    }
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // 测试2: 搜索"鬼灭之刃"
    console.log('🔍 测试2: 搜索"鬼灭之刃"');
    const result2 = await searchDanmu({
      title: '鬼灭之刃',
      type: 'tv',
      server: server
    });
    if (verbose) {
      console.log('✅ 搜索结果:', JSON.stringify(result2, null, 2));
    } else {
      console.log(`✅ 搜索结果: 找到 ${result2.animes ? result2.animes.length : 0} 个动漫`);
    }
    
    if (result2.animes && result2.animes.length > 0) {
      const anime = result2.animes[0];
      console.log(`📺 找到动漫: ${anime.animeTitle} (ID: ${anime.animeId})`);
      
      // 通过 getDetailById 获取 episodes
      console.log('🎬 获取 episodes...');
      const episodes = await getDetailById({
        animeId: anime.animeId,
        server: server
      });
      if (verbose) {
        console.log('✅ Episodes:', JSON.stringify(episodes, null, 2));
      } else {
        console.log(`✅ Episodes: 获取到 ${episodes ? episodes.length : 0} 集`);
      }
      
      if (episodes && episodes.length > 0) {
        const episode = episodes[0];
        console.log(`🎬 测试第1集: ${episode.episodeTitle} (ID: ${episode.episodeId})`);
        
        // 获取弹幕评论
        console.log('💬 获取弹幕评论...');
        const comments = await getCommentsById({
          commentId: episode.episodeId,
          server: server
        });
        if (verbose) {
          console.log('✅ 弹幕评论:', JSON.stringify(comments, null, 2));
        } else {
          console.log(`✅ 弹幕评论: 获取到 ${comments && comments.comments ? comments.comments.length : 0} 条弹幕`);
        }
      }
    }
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // 测试3: 搜索"进击的巨人"并指定第3季
    console.log('🔍 测试3: 搜索"进击的巨人"第3季');
    const result3 = await searchDanmu({
      title: '进击的巨人',
      season: '3',
      type: 'tv',
      server: server
    });
    if (verbose) {
      console.log('✅ 搜索结果:', JSON.stringify(result3, null, 2));
    } else {
      console.log(`✅ 搜索结果: 找到 ${result3.animes ? result3.animes.length : 0} 个动漫`);
    }
    
    if (result3.animes && result3.animes.length > 0) {
      const anime = result3.animes[0];
      console.log(`📺 找到动漫: ${anime.animeTitle} (ID: ${anime.animeId})`);
      
      // 通过 getDetailById 获取 episodes
      console.log('🎬 获取 episodes...');
      const episodes = await getDetailById({
        animeId: anime.animeId,
        server: server
      });
      if (verbose) {
        console.log('✅ Episodes:', JSON.stringify(episodes, null, 2));
      } else {
        console.log(`✅ Episodes: 获取到 ${episodes ? episodes.length : 0} 集`);
      }
      
      if (episodes && episodes.length > 0) {
        const episode = episodes[0];
        console.log(`🎬 测试第1集: ${episode.episodeTitle} (ID: ${episode.episodeId})`);
        
        // 获取弹幕评论
        console.log('💬 获取弹幕评论...');
        const comments = await getCommentsById({
          commentId: episode.episodeId,
          server: server
        });
        if (verbose) {
          console.log('✅ 弹幕评论:', JSON.stringify(comments, null, 2));
        } else {
          console.log(`✅ 弹幕评论: 获取到 ${comments && comments.comments ? comments.comments.length : 0} 条弹幕`);
        }
      }
    }
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // 测试4: 搜索不存在的动漫
    console.log('🔍 测试4: 搜索不存在的动漫"不存在的动漫名称12345"');
    const result4 = await searchDanmu({
      title: '不存在的动漫名称12345',
      type: 'tv',
      server: server
    });
    if (verbose) {
      console.log('✅ 搜索结果:', JSON.stringify(result4, null, 2));
    } else {
      console.log(`✅ 搜索结果: 找到 ${result4.animes ? result4.animes.length : 0} 个动漫`);
    }
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // 测试5: 测试中文数字匹配
    console.log('🔍 测试5: 搜索"火影忍者"第"二"季');
    const result5 = await searchDanmu({
      title: '火影忍者',
      season: '二',
      type: 'tv',
      server: server
    });
    if (verbose) {
      console.log('✅ 搜索结果:', JSON.stringify(result5, null, 2));
    } else {
      console.log(`✅ 搜索结果: 找到 ${result5.animes ? result5.animes.length : 0} 个动漫`);
    }
    
    if (result5.animes && result5.animes.length > 0) {
      const anime = result5.animes[0];
      console.log(`📺 找到动漫: ${anime.animeTitle} (ID: ${anime.animeId})`);
      
      // 通过 getDetailById 获取 episodes
      console.log('🎬 获取 episodes...');
      const episodes = await getDetailById({
        animeId: anime.animeId,
        server: server
      });
      if (verbose) {
        console.log('✅ Episodes:', JSON.stringify(episodes, null, 2));
      } else {
        console.log(`✅ Episodes: 获取到 ${episodes ? episodes.length : 0} 集`);
      }
    }
    
    console.log('\n=== 所有测试完成 ===');
    
  } catch (error) {
    console.error('❌ 测试失败:', error);
  }
}

// 运行测试
testNewFlow(); 