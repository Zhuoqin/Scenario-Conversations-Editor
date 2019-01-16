import {
    select,
    json,
    tree,
    hierarchy,
    linkHorizontal,
    zoom,
    event
} from 'd3';

import _ = require('lodash');
import nunjucks = require('nunjucks');

declare let $: any;
declare let window: any;

export class EditorClass {
    private $container;
    private static $responseTemplate;
    private static $conversationTemplate;
    private config: any;
    private $canvas;

    constructor(container?: JQuery<HTMLElement>) {
        this.$container = container;
        this.$canvas = container.children('.canvas')
        EditorClass.$responseTemplate = container
            .find('.conversation_templates.response_template__js.hidden')
            .clone()
            .removeClass('hidden');
        EditorClass.$conversationTemplate = container
            .find('.conversation_templates.conversation_template__js.hidden')
            .clone()
            .removeClass('hidden');

        this.setupEvents();
        this.buildContent().then();
    }

    private setupEvents(): void {
        this.$container.on('click', '.add-response-btn', (e) => {
            e.preventDefault();
            const $listContainer = $(e.target).closest('.conversation_template__js').children('.responses_list__js');
            this.getResponseTemplate().appendTo($listContainer);
        });

        this.$container.on('click', '.conversation_template__js .trash-response-btn', function (e) {
            e.preventDefault();
            $(e.target).closest('.response_template__js').remove();
        });
    }

    private async buildContent() {
        this.config = await this.retrieveFakeData();
        this.buildMapList();
    }

    private buildMapList() {
        const root = hierarchy(this.config);
        const testData = root.descendants();
        console.log(testData);
        testData.forEach(al => {
            // root
            if (!al.depth) {
                console.log(al);
                let $conversation = nunjucks.renderString(EditorClass.$conversationTemplate.get(0).outerHTML, al.data);
                $($conversation).appendTo(this.$canvas);
            }
        });
    }

    private retrieveFakeData(): Promise<any> {
        return json('/data.json');
    }

    private getResponseTemplate(): JQuery<HTMLElement> {
        return EditorClass.$responseTemplate.clone();
    }

    private getConversationTemplate(): JQuery<HTMLElement> {
        return EditorClass.$conversationTemplate.clone();
    }
}