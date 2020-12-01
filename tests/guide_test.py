from __future__ import division
from __future__ import print_function

# Copyright 2020 Google Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License")
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import unittest
import testing_config  # Must be imported before the module under test.
import urllib

import mock
import webapp2
from webob import exc

import models
import guide


class FeatureNewTest(unittest.TestCase):

  def setUp(self):
    request = webapp2.Request.blank('/guide/new')
    response = webapp2.Response()
    self.handler = guide.FeatureNew(request, response)

  def test_get__anon(self):
    """Anon cannot create features, gets a redirect to sign in page."""
    testing_config.sign_out()
    self.handler.get(self.handler.request.path)
    self.assertEqual('302 Moved Temporarily', self.handler.response.status)

  def test_get__non_allowed(self):
    """Non-allowed cannot create features, gets a 401."""
    testing_config.sign_in('user1@example.com', 1234567890)
    self.handler.get(self.handler.request.path)
    self.assertEqual('401 Unauthorized', self.handler.response.status)

  @mock.patch('guide.FeatureNew.render')
  def test_get__normal(self, mock_render):
    """Allowed users render a page with a django form."""
    testing_config.sign_in('user1@google.com', 1234567890)
    self.handler.get(self.handler.request.path)
    self.assertEqual('200 OK', self.handler.response.status)
    mock_render.assert_called_once()
    template_data = mock_render.call_args.kwargs['data']
    self.assertTrue('overview_form' in template_data)
    form = template_data['overview_form']
    field = form.fields['owner']
    self.assertEqual(
        'user1@google.com',
        form.get_initial_for_field(field, 'owner'))

  def test_post__anon(self):
    """Anon cannot create features, gets a 401."""
    testing_config.sign_out()
    self.handler.post(self.handler.request.path)
    self.assertEqual('401 Unauthorized', self.handler.response.status)

  def test_post__non_allowed(self):
    """Non-allowed cannot create features, gets a 401."""
    testing_config.sign_in('user1@example.com', 1234567890)
    self.handler.post(self.handler.request.path)
    self.assertEqual('401 Unauthorized', self.handler.response.status)

  def test_post__normal_valid(self):
    """Allowed user can create a feature."""
    testing_config.sign_in('user1@google.com', 1234567890)
    self.handler.request = webapp2.Request.blank(
        '/guide/new',
        POST = {
            'category': '1',
            'name': 'Feature name',
            'summary': 'Feature summary',
        })

    self.handler.post(self.handler.request.path)

    self.assertEqual('302 Moved Temporarily', self.handler.response.status)
    location = self.handler.response.headers['location']
    self.assertTrue(location.startswith('http://localhost/guide/edit/'))
    new_feature_id = int(location.split('/')[-1])
    feature = models.Feature.get_by_id(new_feature_id)
    self.assertEqual(1, feature.category)
    self.assertEqual('Feature name', feature.name)
    self.assertEqual('Feature summary', feature.summary)
    feature.delete()


class ProcessOverviewTest(unittest.TestCase):

  def setUp(self):
    self.feature_1 = models.Feature(
        name='feature one', summary='sum', category=1, visibility=1,
        standardization=1, web_dev_views=1, impl_status_chrome=1)
    self.feature_1.put()

    request = webapp2.Request.blank(
        '/guide/edit/%d' % self.feature_1.key().id())
    response = webapp2.Response()
    self.handler = guide.ProcessOverview(request, response)

  def tearDown(self):
    self.feature_1.delete()

  def test_detect_progress__no_progress(self):
    """A new feature has earned no progress items."""
    actual = self.handler.detect_progress(self.feature_1)
    self.assertEqual({}, actual)

  def test_detect_progress__some_progress(self):
    """We can detect some progress."""
    self.feature_1.motivation = 'something'
    actual = self.handler.detect_progress(self.feature_1)
    self.assertEqual({'Motivation': 'True'}, actual)

  def test_detect_progress__progress_item_links(self):
    """Fields with multiple URLs use the first URL in progress item."""
    self.feature_1.doc_links = ['http://one', 'http://two']
    actual = self.handler.detect_progress(self.feature_1)
    self.assertEqual({'Doc links': 'http://one'}, actual)

  @mock.patch('guide.ProcessOverview.render')
  def test_get__anon(self, mock_render):
    """Anon cannot edit features, gets a redirect to viewing page."""
    testing_config.sign_out()
    self.handler.get('/guide/edit', self.feature_1.key().id())
    self.assertEqual('302 Moved Temporarily', self.handler.response.status)
    mock_render.assert_not_called()

  @mock.patch('guide.ProcessOverview.render')
  def test_get__non_allowed(self, mock_render):
    """Non-allowed cannot create features, gets a 401."""
    testing_config.sign_in('user1@example.com', 1234567890)
    self.handler.get('/guide/edit', self.feature_1.key().id())
    self.assertEqual('401 Unauthorized', self.handler.response.status)
    mock_render.assert_not_called()

  @mock.patch('guide.ProcessOverview.render')
  def test_get__not_found(self, mock_render):
    """Allowed users get a 404 if there is no such feature."""
    testing_config.sign_in('user1@google.com', 1234567890)
    with self.assertRaises(exc.HTTPNotFound):
      self.handler.get('/guide/edit', 999)
    mock_render.assert_not_called()

  @mock.patch('guide.ProcessOverview.render')
  def test_get__normal(self, mock_render):
    """Allowed users render a page with a process overview."""
    testing_config.sign_in('user1@google.com', 1234567890)
    self.handler.get('/guide/edit', self.feature_1.key().id())
    self.assertEqual('200 OK', self.handler.response.status)
    mock_render.assert_called_once()
    template_data = mock_render.call_args.kwargs['data']
    self.assertTrue('overview_form' in template_data)
    self.assertTrue('process_json' in template_data)
    self.assertTrue('progress_so_far' in template_data)


class FeatureEditStageTest(unittest.TestCase):

  def setUp(self):
    self.feature_1 = models.Feature(
        name='feature one', summary='sum', category=1, visibility=1,
        standardization=1, web_dev_views=1, impl_status_chrome=1)
    self.feature_1.put()
    self.stage = models.INTENT_INCUBATE  # Shows first form

    request = webapp2.Request.blank(
        '/guide/stage/%d/%d' % (self.feature_1.key().id(), self.stage))
    response = webapp2.Response()
    self.handler = guide.FeatureEditStage(request, response)

  def tearDown(self):
    self.feature_1.delete()

  def test_touched(self):
    """We can tell if the user meant to edit a field."""
    # TODO(jrobbins): for now, this just looks at all HTML form fields.
    self.handler.request = webapp2.Request.blank(
        'path', POST={'name': 'new name'})
    self.assertTrue(self.handler.touched('name'))
    self.assertFalse(self.handler.touched('summary'))

  def test_split_input(self):
    """We can parse items from multi-item text fields"""
    self.handler.request = webapp2.Request.blank(
        'path', POST={
            'empty': '',
            'colors': 'yellow\nblue',
            'names': 'alice, bob',
        })
    self.assertEqual([], self.handler.split_input('missing'))
    self.assertEqual([], self.handler.split_input('empty'))
    self.assertEqual(
        ['yellow', 'blue'],
        self.handler.split_input('colors'))
    self.assertEqual(
        ['alice', 'bob'],
        self.handler.split_input('names', delim=','))

  @mock.patch('guide.FeatureEditStage.render')
  def test_get__anon(self, mock_render):
    """Anon cannot edit features, gets a redirect to viewing page."""
    testing_config.sign_out()
    self.handler.get('/guide/stage', self.feature_1.key().id(), self.stage)
    self.assertEqual('302 Moved Temporarily', self.handler.response.status)
    mock_render.assert_not_called()

  @mock.patch('guide.FeatureEditStage.render')
  def test_get__non_allowed(self, mock_render):
    """Non-allowed cannot edit features, gets a 401."""
    testing_config.sign_in('user1@example.com', 1234567890)
    self.handler.get('/guide/stage', self.feature_1.key().id(), self.stage)
    self.assertEqual('401 Unauthorized', self.handler.response.status)
    mock_render.assert_not_called()

  @mock.patch('guide.FeatureEditStage.render')
  def test_get__not_found(self, mock_render):
    """Allowed users get a 404 if there is no such feature."""
    testing_config.sign_in('user1@google.com', 1234567890)
    with self.assertRaises(exc.HTTPNotFound):
      self.handler.get('/guide/stage', 999, self.stage)
    mock_render.assert_not_called()

  @mock.patch('guide.FeatureEditStage.render')
  def test_get__normal(self, mock_render):
    """Allowed users render a page with a django form."""
    testing_config.sign_in('user1@google.com', 1234567890)
    self.handler.get('/guide/stage', self.feature_1.key().id(), self.stage)
    self.assertEqual('200 OK', self.handler.response.status)
    mock_render.assert_called_once()
    template_data = mock_render.call_args.kwargs['data']
    self.assertTrue('feature' in template_data)
    self.assertTrue('feature_id' in template_data)
    self.assertTrue('feature_form' in template_data)
    self.assertTrue('already_on_this_stage' in template_data)

  @mock.patch('guide.FeatureEditStage.render')
  def test_get__not_on_this_stage(self, mock_render):
    """When feature is no on the stage for the current form, offer checkbox."""
    testing_config.sign_in('user1@google.com', 1234567890)
    self.handler.get('/guide/stage', self.feature_1.key().id(), self.stage)
    self.assertEqual('200 OK', self.handler.response.status)
    mock_render.assert_called_once()
    template_data = mock_render.call_args.kwargs['data']
    self.assertFalse(template_data['already_on_this_stage'])

  @mock.patch('guide.FeatureEditStage.render')
  def test_get__already_on_this_stage(self, mock_render):
    """When feature is already on the stage for the current form, say that."""
    self.feature_1.intent_stage = self.stage
    self.feature_1.put()
    testing_config.sign_in('user1@google.com', 1234567890)
    self.handler.get('/guide/stage', self.feature_1.key().id(), self.stage)
    self.assertEqual('200 OK', self.handler.response.status)
    mock_render.assert_called_once()
    template_data = mock_render.call_args.kwargs['data']
    self.assertTrue(template_data['already_on_this_stage'])

  def test_post__anon(self):
    """Anon cannot edit features, gets a 401."""
    testing_config.sign_out()
    self.handler.post('/guide/stage', self.feature_1.key().id(), self.stage)
    self.assertEqual('401 Unauthorized', self.handler.response.status)

  def test_post__non_allowed(self):
    """Non-allowed cannot edit features, gets a 401."""
    testing_config.sign_in('user1@example.com', 1234567890)
    self.handler.post('/guide/stage', self.feature_1.key().id(), self.stage)
    self.assertEqual('401 Unauthorized', self.handler.response.status)

  def test_post__normal_valid(self):
    """Allowed user can edit a feature."""
    testing_config.sign_in('user1@google.com', 1234567890)
    self.handler.request = webapp2.Request.blank(
        '/guide/stage/%d/%d' % (self.feature_1.key().id(), self.stage),
        POST = {
            'category': '2',
            'name': 'Revised feature name',
            'summary': 'Revised feature summary',
            'shipped_milestone': '84',
        })

    self.handler.post('/guide/stage', self.feature_1.key().id(), self.stage)

    self.assertEqual('302 Moved Temporarily', self.handler.response.status)
    location = self.handler.response.headers['location']
    self.assertEqual('http://localhost/guide/edit/%d' % self.feature_1.key().id(),
                     location)
    revised_feature = models.Feature.get_by_id(self.feature_1.key().id())
    self.assertEqual(2, revised_feature.category)
    self.assertEqual('Revised feature name', revised_feature.name)
    self.assertEqual('Revised feature summary', revised_feature.summary)
    self.assertEqual(84, revised_feature.shipped_milestone)
