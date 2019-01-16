import {
    select,
    json,
    tree,
    hierarchy,
    linkHorizontal,
    zoom,
    event,
} from 'd3';

import _ = require('lodash');
import nunjucks = require('nunjucks');

declare let $: any;
declare let d3: any;
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

        this.$container.on('click', '.connector', function (e) {
            e.preventDefault();
            $(e.target).toggleClass('active');
        });


        this.$canvas.on('click', function (e) {
            e.preventDefault();
            if (!$(e.target).hasClass('connector')) {
                $('.connector').removeClass('active');
            }
        });
    }

    private async buildContent() {
        this.config = await this.retrieveFakeData();
        this.buildMapList();
    }

    private buildMapList() {
        const root = hierarchy(this.config);
        const testData = root.descendants();
        const conversationRenderString = EditorClass.$conversationTemplate.get(0).outerHTML;
        let gaps = 100;
        let space = 15;
        let conversation_width;
        let conversation_height;
        let corePosition;
        let currentDepth;
        let depthCounter = 0;
        let coreConversation;
        testData.forEach(al => {
            // root
            if (currentDepth === al.depth) {
                depthCounter++;
            }
            currentDepth = al.depth;
            if (!currentDepth) {
                coreConversation = nunjucks.renderString(conversationRenderString, al.data);
                $(coreConversation).appendTo(this.$canvas);
                corePosition = $('.conversation_start').position();
                conversation_height = $('.conversation_start').height();
                conversation_width = $('.conversation_start').width();
                // continue
                return true;
            }

            let left = corePosition.left;
            let radius = left + currentDepth * (conversation_width + space);
            let top = depthCounter * (conversation_height + space);
            let conversation = nunjucks.renderString(conversationRenderString, al.data);
            $(conversation).css({left: radius, top: top}).removeClass('conversation_start').appendTo(this.$canvas);
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