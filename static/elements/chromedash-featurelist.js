import {LitElement, html} from 'https://unpkg.com/@polymer/lit-element@latest/lit-element.js?module';
import '/static/elements/chromedash-feature.js';

class ChromedashFeaturelist extends LitElement {
  static get properties() {
    return {
      whitelisted: {type: Boolean}, // From attribute
      features: {type: Array, attribute: false}, // Directly edited and accessed in template/features.html
      metadataEl: {type: Object}, // The metadata component element. Directly edited in template/features.html
      searchEl: {type: Object}, // The search input element. Directly edited in template/features.html
      filtered: {type: Array},
    };
  }

  constructor() {
    super();
    this.features = [];
    this.filtered = [];
    this.metadataEl = document.querySelector('chromedash-metadata');
    this.searchEl = document.querySelector('.search input');
    this.whitelisted = false;
    this._hasInitialized = false; // Used to check initialization code.
    this._hasScrolledByUser = false; // Used to set the app header state.

    this._featuresUnveilMetric = new Metric('features_unveil');
    this._featuresFetchMetric = new Metric('features_loaded');
    this._featuresUnveilMetric.start();
    this._featuresFetchMetric.start();

    this._loadData();
  }

  async _loadData() {
    const featureUrl = location.hostname == 'localhost' ?
      'https://www.chromestatus.com/features_v2.json' : '/features_v2.json';

    try {
      const features = await (await fetch(featureUrl)).json();
      this._featuresFetchMetric.end().log().sendToAnalytics('features', 'loaded');

      features.map((feature) => {
        feature.receivePush = false;
        feature.milestone = feature.browsers.chrome.desktop ||
            feature.browsers.chrome.android ||
            feature.browsers.chrome.webview ||
            feature.browsers.chrome.ios ||
            Infinity;
      });
      this.features = features;

      this.searchEl.disabled = false;
      this.filter(this.searchEl.value);
      this._initialize();
    } catch (error) {
      document.getElementById('content').classList.add('error');
      console.error(error);
      throw new Error('Failed to fetch features');
    };
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('scroll', this._onScrollList.bind(this));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('scroll', this._onScrollList.bind(this));
  }

  _fireEvent(eventName, detail) {
    let event = new CustomEvent(eventName, {detail});
    this.dispatchEvent(event);
  }

  _getSearchStrRegExp(searchStr) {
    return new RegExp(
      // Case-insensitive match on literal string; escape characters that
      // have special meaning in regular expressions.
      searchStr.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&'), 'i');
  }

  _pathToPropertyVal(propPath, feature) {
    return propPath.split('.').reduce((obj, key) => {
      return obj[key];
    }, feature);
  }

  _lt(propPath, value, feature) {
    return this._pathToPropertyVal(propPath, feature) < value;
  }
  _lte(propPath, value, feature) {
    return this._pathToPropertyVal(propPath, feature) <= value;
  }
  _gt(propPath, value, feature) {
    return this._pathToPropertyVal(propPath, feature) > value;
  }
  _gte(propPath, value, feature) {
    return this._pathToPropertyVal(propPath, feature) >= value;
  }
  _eq(propPath, value, feature) {
    return this._pathToPropertyVal(propPath, feature) === value;
  }
  _false() {
    return false;
  }

  _getOperatorFilter(args /* [propPath, operator, valueStr] */) {
    const value = parseFloat(args[2]);
    if (isNaN(value)) return this._false;

    switch (args[1].trim()) {
      case '<':
        return this._lt.bind(this, args[0], value);
        break;
      case '<=':
        return this._lte.bind(this, args[0], value);
        break;
      case '>':
        return this._gt.bind(this, args[0], value);
        break;
      case '>=':
        return this._gte.bind(this, args[0], value);
        break;
      case '=': // Support both '=' and '=='.
      case '==':
        return this._eq.bind(this, args[0], value);
        break;
      default:
        return this._false;
    }
  }

  _filterProperty(propPath, regExp, feature) {
    const value = this._pathToPropertyVal(propPath, feature);

    // Null or missing values never match.
    if (value === null || typeof value === 'undefined') {
      return false;
    }

    // Allow for enums that store string in "text" property.
    return (value.text || value).toString().match(regExp) !== null;
  }

  _getPropertyFilter(args /* [propPath, searchStr] */) {
    return this._filterProperty.bind(
      this, args[0], this._getSearchStrRegExp(args[1]));
  }

  _filterKeyword(regExp, feature) {
    return (feature.name + '\n' + feature.summary + '\n' + feature.comments)
      .match(regExp) !== null;
  }

  _getKeywordFilter(keyword) {
    return this._filterKeyword.bind(
      this, this._getSearchStrRegExp(keyword));
  }

  // Directly called from template/features.html
  filter(val) {
    // Clear filter if there's no search or if called directly.
    if (!val) {
      if (history && history.replaceState) {
        history.replaceState('', document.title, location.pathname + location.search);
      } else {
        location.hash = '';
      }
      this.filtered = this.features;
    } else {
      val = val.trim();
      if (history && history.replaceState) {
        history.replaceState({id: null}, document.title,
          '/features#' + encodeURIComponent(val));
      }

      const blinkComponent = val.match(/^component:\s?(.*)/);
      if (blinkComponent) {
        const componentName = blinkComponent[1].trim();
        this.filtered = this.features.filter(feature => (
          feature.browsers.chrome.blink_components.includes(componentName)
        ));
        this._fireEvent('filtered', {count: this.filtered.length});
        return;
      }

      const regExp = /"([^"]*)"/g;
      const start = 0;
      const parts = [];
      let match;
      while ((match = regExp.exec(val)) !== null) {
        if (start - (regExp.lastIndex - match[0].length) > 0) {
          parts.push(val.substring(start, regExp.lastIndex -
                                   match[0].length));
        }
        parts.push(match[1]);
      }
      const matchLen = match ? match[0].length : 0;
      if (start - (regExp.lastIndex - matchLen) > 0) {
        parts.push(val.substring(start, regExp.lastIndex -
                                 matchLen));
      }

      // Match words separated by whitespace and/or ":" and/or ordered
      // comparison operator.
      const wordRegExp = /("([^"]+)"|([^:<>= \f\n\r\t\v\u00a0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+))([:<>= \f\n\r\t\v\u00a0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+)?/g;
      // Array of matches, each an array of the form:
      // [ full match, quoted-string-or-word, contents-of-quoted-string,
      //   word, separator ].
      const reMatches = [];
      while ((match = wordRegExp.exec(val)) !== null) {
        reMatches.push(match);
      }

      // Query parts of the form: "name : value".
      const propertyQueries = [];
      // Query parts of the form: "name = value", "name < value", etc.
      const operatorQueries = [];
      // Other words in the query (not matching forms above).
      const keywordQueries = [];

      // Accumulate keyword and property queries.
      for (let i = 0; i < reMatches.length; i++) {
        match = reMatches[i];
        const part = match[2] || match[3];
        const sep = match[4];
        const nextPart = i < reMatches.length - 1 ?
          (reMatches[i + 1][2] || reMatches[i + 1][3]) : null;
        if (sep && sep.trim().match(/^:$/) !== null && nextPart !== null) {
          // Separator is ":", and there exists a right-hand-side.
          // Store property query: "propertyName : propertyValue".
          propertyQueries.push([part, nextPart]);
          i++;
        } else if (sep && sep.trim().match(/^(<=|>=|==|<|>|=)$/) !== null &&
            nextPart !== null) {
          // Separator is an ordered comparison operator and there exists a
          // right-hand-side.
          // Store operator query "name <<operator>> value".
          operatorQueries.push([part, sep, nextPart]);
          i++;
        } else {
          // No special operator found. Store non-separator part as keyword
          // query.
          keywordQueries.push(part);
        }
      }

      // Construct a list filter for each query part, and store them all in
      // a list.
      const filters = propertyQueries.map(this._getPropertyFilter.bind(this))
        .concat(operatorQueries.map(this._getOperatorFilter.bind(this)))
        .concat(keywordQueries.map(this._getKeywordFilter.bind(this)));

      // Apply this.filtered = this.features filtered-by filters.
      if (filters.length === 0) {
        this.filtered = this.features;
      } else {
        let results = this.features;
        for (let i = 0; i < filters.length; i++) {
          results = results.filter(filters[i]);
        }
        this.filtered = results;
      }
    }

    this._fireEvent('filtered', {count: this.filtered.length});
  }

  _firstOfMilestone(milestone) {
    for (let i = 0; i < this.filtered.length; i++) {
      const feature = this.filtered[i];
      if (feature.first_of_milestone &&
          (milestone === feature.browsers.chrome.desktop ||
           milestone === feature.browsers.chrome.status.text)) {
        return feature.id;
      }
    }
    return null;
  }

  scrollToMilestone(milestone) {
    const id = this._firstOfMilestone(milestone);
    if (id) {
      this.scrollToId(id);
    }
  }

  // Directly called from template/features.html
  scrollToId(targetId) {
    if (!targetId) return;

    let selector;
    if (!isNaN(Number(targetId))) {
      /* number is not valid id. so we added prefix 'id-' in the template. */
      selector = `#id-${targetId}`;
    } else {
      selector = `#${targetId}`;
    }
    const targetElement = document.querySelector(selector);
    if (!targetElement) return;

    const SCROLL_PADDING = 130;
    document.scrollTo({
      top: targetElement.offsetTop - SCROLL_PADDING,
      left: 0,
      behavior: 'smooth',
    });
  }

  _onScrollList() {
    if (!this._hasInitialized) {
      return;
    }
    if (!this._hasScrolledByUser) {
      this._hasScrolledByUser = true;
      this._fireEvent('has-scroll-list'); // Nofity the app to un-fix header.
    }
    // TODO(yangguang): Get the first visible index
    // const feature = this.features[this.$.ironlist.firstVisibleIndex];
    // const feature = this.features[0];
    // this.metadataEl.selectMilestone(feature);
  }

  /** Scroll to the item in the URL. Otherwise the first 'In development' item */
  _scrollToInitialPosition() {
    const lastSlash = location.pathname.lastIndexOf('/');
    if (lastSlash > 0) {
      const id = parseInt(location.pathname.substring(lastSlash + 1));
      this.scrollToId(id);
    } else {
      const milestone = this.metadataEl.implStatuses[this.metadataEl.status.IN_DEVELOPMENT - 1].val;
      this.scrollToMilestone(milestone);
    }
  }

  _initialize() {
    this._featuresUnveilMetric.end().log().sendToAnalytics('features', 'unveil');
    this._fireEvent('app-ready');
    this._hasInitialized = true;
    setTimeout(() => {
      this._scrollToInitialPosition();
    }, 300);
  }

  /* eslint no-unused-vars: ["error", { "args": "after-used" }] */
  _onFeatureToggled(e) {
    const feature = e.detail.feature;
    const open = e.detail.open;

    if (history && history.replaceState) {
      if (open) {
        history.pushState({id: feature.id}, feature.name, '/features/' + feature.id);
      } else {
        const hash = this.searchEl.value ? '#' + this.searchEl.value : '';
        history.replaceState({id: null}, feature.name, '/features' + hash);
      }
    }
  }

  _computeMilestoneHidden(feature, features, filtered) {
    return filtered.length != features.length || !feature.first_of_milestone;
  }

  _computeMilestoneString(str) {
    return isNaN(parseInt(str)) ? str : 'Chrome ' + str;
  }

  render() {
    return html`
      <link rel="stylesheet" href="/static/css/elements/chromedash-featurelist.css">

      ${this.filtered.map((feature) => html`
        <div class="item">
          <div ?hidden="${this._computeMilestoneHidden(feature, this.features, this.filtered)}"
               class="milestone-marker">${this._computeMilestoneString(feature.browsers.chrome.status.milestone_str)}</div>
          <chromedash-feature id="id-${feature.id}" tabindex="0"
               @feature-toggled="${this._onFeatureToggled}"
               .feature="${feature}" ?whitelisted="${this.whitelisted}"></chromedash-feature>
        </div>
        `)}
    `;
  }
}

customElements.define('chromedash-featurelist', ChromedashFeaturelist);
