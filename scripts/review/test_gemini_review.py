import base64
import copy
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import gemini_review as review


class ReviewTests(unittest.TestCase):
    def test_sensitive_files_and_traversal_excluded(self):
        for path in ['.env', '.env.production.json', 'secrets/config.json', '../x.ts', '/x.ts', 'key.pem', 'pnpm-lock.yaml']:
            self.assertFalse(review.allowed_path(path), path)
        self.assertTrue(review.allowed_path('components/timeline.tsx'))

    def test_only_completed_model_output_is_used(self):
        response = {'status': 'completed', 'steps': [
            {'type': 'thought', 'content': [{'type': 'text', 'text': 'private thought'}]},
            {'type': 'model_output', 'content': [{'type': 'text', 'text': 'review'}]}]}
        self.assertEqual(review.extract_text(response), 'review')
        response['status'] = 'incomplete'
        with self.assertRaises(review.ReviewError):
            review.extract_text(response)
        with self.assertRaises(review.ReviewError):
            review.extract_text({'status': 'completed', 'steps': []})

    def test_summary_cannot_render_model_images_or_html(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'summary'
            with patch.dict(os.environ, {'GITHUB_STEP_SUMMARY': str(path)}):
                review.write_summary('</pre><img src="https://example.invalid"> ![x](url)')
            self.assertNotIn('<img', path.read_text())
            self.assertIn('&lt;/pre&gt;', path.read_text())

    def test_snapshot_and_omission(self):
        pr = {'base': {'repo': {'full_name': review.REPO}, 'sha': 'a'*40},
              'head': {'sha': 'b'*40}, 'title': 'Test', 'body': None}
        files = [{'filename': 'lib/a.ts', 'status': 'modified', 'patch': '+a'},
                 {'filename': '.env.production.json', 'status': 'modified', 'patch': '+secret'}]
        def get(path):
            if '/files?' in path:
                return files
            if '/contents/' in path:
                self.assertIn('ref=' + 'b'*40, path)
                return {'encoding': 'base64', 'size': 1, 'content': base64.b64encode(b'a').decode()}
            return copy.deepcopy(pr)
        data = review.collect_review(10, get)
        self.assertEqual(len(data['files']), 1)
        self.assertEqual(len(data['omitted']), 1)
        self.assertEqual(data['files'][0]['head_content'], 'a')
        reads = 0
        def moving_get(path):
            nonlocal reads
            if '/files?' in path:
                return files
            reads += 1
            value = copy.deepcopy(pr)
            if reads > 1:
                value['head']['sha'] = 'c'*40
            return value
        with self.assertRaises(review.ReviewError):
            review.collect_review(10, moving_get)

    def test_no_credential_redirect(self):
        self.assertIsNone(review.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.invalid'))


if __name__ == '__main__':
    unittest.main()
