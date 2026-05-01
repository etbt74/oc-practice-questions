module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { studentName, category, week, score, totalQuestions } = req.body;

  const GITHUB_PAT      = process.env.GITHUB_PAT;
  const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
  const GITHUB_REPO     = process.env.GITHUB_REPO;

  if (!GITHUB_PAT || !GITHUB_USERNAME || !GITHUB_REPO) {
    return res.status(500).json({ error: 'Server not configured — missing env vars.' });
  }

  const apiUrl = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/results/results.json`;
  const headers = {
    Authorization: `token ${GITHUB_PAT}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'OC-Practice-App'
  };

  // Fetch current results
  let currentResults = [];
  let sha = null;

  try {
    const getRes = await fetch(apiUrl, { headers });
    if (getRes.ok) {
      const fileData = await getRes.json();
      sha = fileData.sha;
      const decoded = Buffer.from(fileData.content, 'base64').toString('utf8');
      currentResults = JSON.parse(decoded);
    }
  } catch (_) {
    // File doesn't exist yet — start fresh
  }

  // Build new result entry
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

  currentResults.push(newResult);

  // Push updated results.json back to GitHub
  const putBody = {
    message: `Result: ${category} Week ${week} — ${pct}% (${new Date().toLocaleDateString('en-AU')})`,
    content: Buffer.from(JSON.stringify(currentResults, null, 2)).toString('base64')
  };
  if (sha) putBody.sha = sha;

  try {
    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify(putBody)
    });
    if (!putRes.ok) {
      const err = await putRes.json();
      console.error('GitHub PUT error:', err);
      return res.status(500).json({ error: 'Failed to save result to GitHub.' });
    }
  } catch (e) {
    console.error('Fetch error:', e);
    return res.status(500).json({ error: 'Network error saving result.' });
  }

  return res.status(200).json({ success: true, result: newResult });
};
