module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { studentName, category, week, score, totalQuestions } = req.body || {};

  const GITHUB_PAT      = process.env.GITHUB_PAT;
  const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
  const GITHUB_REPO     = process.env.GITHUB_REPO;

  if (!GITHUB_PAT || !GITHUB_USERNAME || !GITHUB_REPO) {
    console.error('Missing env vars:', { GITHUB_PAT: !!GITHUB_PAT, GITHUB_USERNAME: !!GITHUB_USERNAME, GITHUB_REPO: !!GITHUB_REPO });
    return res.status(500).json({ error: 'Server not configured — missing environment variables.' });
  }

  const apiUrl = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/results/results.json`;
  const ghHeaders = {
    Authorization: `token ${GITHUB_PAT}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'OC-Practice-App'
  };

  const pct = Math.round((parseInt(score) / parseInt(totalQuestions)) * 100);
  const newResult = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    studentName: studentName || 'Student',
    category,
    week: parseInt(week),
    score: parseInt(score),
    totalQuestions: parseInt(totalQuestions),
    percentage: pct
  };

  // Retry up to 3 times to handle sha conflicts
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Fetch current results.json
    let currentResults = [];
    let sha = null;
    try {
      const getRes = await fetch(apiUrl, { headers: ghHeaders });
      if (getRes.ok) {
        const fileData = await getRes.json();
        sha = fileData.sha;
        const decoded = Buffer.from(fileData.content, 'base64').toString('utf8');
        currentResults = JSON.parse(decoded);
      } else if (getRes.status !== 404) {
        const errText = await getRes.text();
        console.error(`GET results.json failed (${getRes.status}):`, errText);
      }
    } catch (e) {
      console.error('Error fetching results.json:', e.message);
    }

    // Append new result
    const updatedResults = [...currentResults, newResult];
    const putBody = {
      message: `Result: ${category} Week ${week} — ${pct}% (${new Date().toLocaleDateString('en-AU')})`,
      content: Buffer.from(JSON.stringify(updatedResults, null, 2)).toString('base64')
    };
    if (sha) putBody.sha = sha;

    try {
      const putRes = await fetch(apiUrl, {
        method: 'PUT',
        headers: ghHeaders,
        body: JSON.stringify(putBody)
      });

      if (putRes.ok) {
        return res.status(200).json({ success: true, result: newResult });
      }

      const errData = await putRes.json();
      console.error(`PUT attempt ${attempt} failed (${putRes.status}):`, errData);

      // 422 = sha conflict — retry
      if (putRes.status === 422 && attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 300 * attempt)); // back off
        continue;
      }

      return res.status(500).json({ error: `GitHub write failed: ${errData.message || putRes.status}` });
    } catch (e) {
      console.error(`PUT attempt ${attempt} exception:`, e.message);
      if (attempt === MAX_RETRIES) {
        return res.status(500).json({ error: `Network error saving result: ${e.message}` });
      }
    }
  }

  return res.status(500).json({ error: 'Failed to save result after multiple attempts.' });
};
