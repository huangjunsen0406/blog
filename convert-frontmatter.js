import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const blogDir = path.join(__dirname, 'src/content/blog');

// 解析 YAML 样式的数组
function parseYamlArray(lines, startIndex) {
  const items = [];
  let i = startIndex + 1;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith('- ')) {
      // 移除 '- ' 并去除引号
      let item = line.substring(2).trim();
      if ((item.startsWith("'") && item.endsWith("'")) ||
          (item.startsWith('"') && item.endsWith('"'))) {
        item = item.slice(1, -1);
      }
      items.push(item);
      i++;
    } else if (line && !line.includes(':')) {
      // 继续处理数组项
      i++;
    } else {
      // 遇到新的键或空行，结束数组
      break;
    }
  }

  return { items, nextIndex: i };
}

// 读取所有 markdown 文件
const files = fs.readdirSync(blogDir).filter(file => file.endsWith('.md') || file.endsWith('.mdx'));

files.forEach(file => {
  const filePath = path.join(blogDir, file);
  const content = fs.readFileSync(filePath, 'utf-8');

  // 检查是否有 frontmatter
  if (!content.startsWith('---')) {
    console.log(`⏭️  Skipping ${file} - no frontmatter`);
    return;
  }

  // 提取 frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    console.log(`⏭️  Skipping ${file} - invalid frontmatter`);
    return;
  }

  const frontmatter = frontmatterMatch[1];
  const body = frontmatterMatch[2];

  // 解析 Hexo frontmatter
  const lines = frontmatter.split('\n');
  const data = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line || !line.includes(':')) {
      i++;
      continue;
    }

    const colonIndex = line.indexOf(':');
    const key = line.substring(0, colonIndex).trim();
    let value = line.substring(colonIndex + 1).trim();

    // 检查是否是数组格式
    if (!value && i + 1 < lines.length && lines[i + 1].trim().startsWith('- ')) {
      // YAML 数组格式
      const result = parseYamlArray(lines, i);
      data[key] = result.items;
      i = result.nextIndex;
      continue;
    }

    // 处理内联数组 [item1, item2]
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(v => v.trim().replace(/^['"]|['"]$/g, ''));
      data[key] = value;
    } else {
      // 移除引号
      if ((value.startsWith("'") && value.endsWith("'")) ||
          (value.startsWith('"') && value.endsWith('"'))) {
        value = value.slice(1, -1);
      }
      data[key] = value;
    }

    i++;
  }

  // 检查是否已经是 Astro 格式
  if (data.pubDate && !data.date) {
    console.log(`✅ ${file} - already in Astro format`);
    return;
  }

  // 转换为 Astro frontmatter
  let newFrontmatter = `---\n`;

  // title (必需)
  if (data.title) {
    newFrontmatter += `title: '${data.title}'\n`;
  }

  // description (从 categories 或 tags 提取，或留空)
  let description = '';
  if (data.categories && Array.isArray(data.categories) && data.categories.length > 0) {
    description = data.categories.join(', ');
  } else if (data.tags && Array.isArray(data.tags) && data.tags.length > 0) {
    description = data.tags.join(', ');
  }
  newFrontmatter += `description: '${description}'\n`;

  // pubDate (从 date 转换)
  if (data.date) {
    newFrontmatter += `pubDate: '${data.date}'\n`;
  }

  // 保留 heroImage 如果存在
  if (data.heroImage) {
    newFrontmatter += `heroImage: '${data.heroImage}'\n`;
  }

  // 添加 tags 数组（如果存在）
  if (data.tags && Array.isArray(data.tags) && data.tags.length > 0) {
    newFrontmatter += `tags: ${JSON.stringify(data.tags)}\n`;
  }

  // 添加 categories 数组（如果存在）
  if (data.categories && Array.isArray(data.categories) && data.categories.length > 0) {
    newFrontmatter += `categories: ${JSON.stringify(data.categories)}\n`;
  }

  newFrontmatter += `---\n`;

  // 写入新内容
  const newContent = newFrontmatter + body;
  fs.writeFileSync(filePath, newContent, 'utf-8');

  console.log(`✅ Converted ${file}`);
  console.log(`   - Categories: ${data.categories ? data.categories.join(', ') : 'none'}`);
  console.log(`   - Tags: ${data.tags ? data.tags.join(', ') : 'none'}`);
});

console.log('\n🎉 Conversion complete!');
