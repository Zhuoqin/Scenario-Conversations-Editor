import * as d3 from "d3";
import {EXPRESSION_NAME_DATA, SETTING_ICON_SVG_STRING} from "./graphics_config_data";
import nunjucks = require('nunjucks');
import uuid = require("uuid");

declare let window: any;
declare let $: any;
declare var _: any;
type Point = [number, number];

export class ConversationEditor {
    private readonly config: any;
    private readonly $canvas;
    private readonly $container;
    private revisionData: any;
    private svgContainer: any;
    private $openModalBtn: any;
    private $modalContainer: any;
    private $svgContainer: JQuery<HTMLElement>;
    public static character: string;  // note: this is able to be configurable

    private static $responseTemplate;
    private static $conversationTemplate;
    private readonly conversationRenderString;
    private readonly responseRenderString;

    // UI behaviours
    private $behaviorsBlock: JQuery<HTMLElement>;
    private $finishBtn: JQuery<HTMLElement>;
    private relationshipCurveLinesCache: Map<string, string>;
    private relationshipPositionCache: Map<string, [number, number][]>;
    private connectorPositionCache: Map<string, [number, number]>;

    // layer settings
    private static LAYER_HIDDEN = -1;
    private static LAYER_DEFAULT = 0;
    private static LAYER_CONVERSATION = 1;
    private static LAYER_ACTIVE_SVG = 2;
    private static LAYER_ON_TOP = 5;

    // draw conversations
    private rootConversation: Conversation;
    private conversations: Map<string, Conversation>;  // conversations group Map<id, Conversation>
    private drawConversations: Set<string>;  // conversations already draw Map<id>
    private responses: Map<string, Response>;   // responses group Map<id, Response>
    private conversationStack: Map<number, number>; // stack for each level of conversations :Map<depth, stack>
    private responseStack: Map<number, number>; // stack for each level of responses :Map<depth, stack>
    private connectorLines: Map<string, RelationshipLine>; // line that has Map<id, Relationship>
    private lineDrawsGroup: any;
    private iterationMaxDepth: number;
    private negativeConversations: Set<Conversation>;
    private static CIRCLE_RADIUS = 0.3;
    private static SVG_CIRCLE_RADIUS = 10;
    private static CONVERSATION_WIDTH = 300;
    private static CONVERSATION_HEIGHT = 250;
    private static RESPONSE_HEIGHT = 135;
    private static CONVERSATION_STACK_SPACE_TEMP = 15;
    private static CONVERSATION_SPACE_X = 250;
    private static CONVERSATION_SPACE_Y = 150;
    private static CONVERSATION_CONNECTOR_WIDTH = 21; // 22px - border 1px
    private static CONVERSATION_LEFT_TOP_OFFSET = 50;   // conversation img offset
    private static CANVAS_LEFT_TOP_SPACE = 50;  // canvas edge padding
    public static DEFAULT_LINE_COLOR = '#ffa700';

    // limit number of responses on each conversation
    public static MAX_RESPONSES_COUNT = 4;

    // line config
    private $relationship_config: JQuery<HTMLElement>;
    private $relationship_config_mask: JQuery<HTMLElement>;
    private editingRelationship: RelationshipLine;

    // guide
    private $guideTipsBlock: JQuery<HTMLElement>;
    private $guideTipsText: JQuery<HTMLElement>;
    private static GUIDE_STEPS = [
        'Configure the conversation’s starting point!',
        'Add responses, and outcomes to those responses.',
        'Nice, you’ve added an outcome!  You can hover over the connector for more options.',
        'Weight influences the likelihood that this outcome is used in a multiple outcome situation.  Points can be negative.',
        'Press "Ctrl" & scroll mouse to control, double click to zoom in.',
        'Each conversation can not have more than ' + ConversationEditor.MAX_RESPONSES_COUNT + ' responses.'
    ];

    private static INVALID_CONVERSATION_MSG = "To continue, please make sure each conversation belongs to at least one response block.";

    // zoom
    private zoomed: boolean;
    private $canvasMask: JQuery<HTMLElement>;

    // image assets
    public static IMAGE_ASSETS_PATH = "assets/images/characters/";
    public static IMAGE_ASSETS_TYPE = 'png';
    private avatarChangeLocker = false;

    constructor(config: any) {
        this.config = config;
        this.$container = $('#scenario_drawer_container');
        this.$modalContainer = $('#scenario_draw_modal');
        this.$openModalBtn = $('#scenario_draw_modal_btn');
        this.$canvas = $('#canvas');
        this.$svgContainer = $('#svg_container');
        this.svgContainer = d3.select('#svg_container');
        this.$guideTipsBlock = this.$modalContainer.find('.guide-bar');
        this.$guideTipsText = this.$guideTipsBlock.children('.guide-text');
        this.$behaviorsBlock = this.$modalContainer.find('.behavior-wrap');
        this.$relationship_config = this.$modalContainer.find('.relationship_config_window');
        this.$relationship_config_mask = this.$modalContainer.find('#relationship_config_window_mask');
        this.$finishBtn = $('#conversation_drawer_finish');
        // zoom part
        this.$canvasMask = $('#canvas-mask');
        this.zoomed = false;
        $('#zoom-container').tooltip();
        $('.tidy-conversation-btn').tooltip();

        ConversationEditor.character = this.config['character'] || '';
        ConversationEditor.$responseTemplate = this.$modalContainer.children('.conversation_templates.response_template__js')
            .clone()
            .removeClass('hidden');
        ConversationEditor.$conversationTemplate = this.$modalContainer.children('.conversation_templates.conversation_template__js')
            .clone()
            .removeClass('hidden');
        this.conversationRenderString = ConversationEditor.$conversationTemplate.get(0).outerHTML;
        this.responseRenderString = ConversationEditor.$responseTemplate.get(0).outerHTML;

        this.setupEvents();
        this.buildMapList();
        this.setupCanvasUIDraggableBehaviours();
        this.setupCanvasUIZoomableBehaviours();
    }

    /**
     * set up the events listeners
     */
    private setupEvents(): void {
        let isBeforeClicked = false;
        let isAfterClicked = false;

        // container
        this.$container.on('click', '.add-response-btn', (e) => {
            e.preventDefault();

            // validating
            if (!this.validateConversations()) {
                // show alert
                alert(ConversationEditor.INVALID_CONVERSATION_MSG);
                return;
            }

            const $target = $(e.target);
            const $currentConversation = $target.closest('.conversation_template__js');
            const conversationID = $currentConversation.data('id');
            let conversation = this.conversations.get(conversationID);
            if (conversation.isMaxResponsesReached()) {
                return;
            }
            // Data related to elements' IDs
            this.responseChangesData('add', conversationID);
            // trigger canvas adjust
            this.tidyConversations();
        });

        this.$container.on('click', '.trash-response-btn', (e) => {
            e.preventDefault();

            // validating
            if (!this.validateConversations()) {
                // show alert
                alert(ConversationEditor.INVALID_CONVERSATION_MSG);
                return;
            }

            const $target = $(e.target);
            const $currentResponse = $target.closest('.response_template__js');
            const $currentConversation = $target.closest('.conversation_template__js');
            let currentResponse = this.responses.get($currentResponse.data('id'));
            if (currentResponse.hasChildren()) {
                alert("This response has sub-conversations, you need to remove them before deleting.");
                return;
            }
            // Data related to elements' IDs
            this.responseChangesData('remove', $currentConversation.data('id'), $currentResponse.data('id'));
            // affect related lines data
            this.updateRelationshipOnRemoval($currentResponse.data('id'));
            // trigger canvas adjust
            this.tidyConversations();
        });

        this.$container.on('click', '.add-outcome-btn', (e) => {
            e.preventDefault();
            const $target = $(e.target);
            const $currentResponse = $target.closest('.response_template__js');
            let response = this.responses.get($currentResponse.data('id'));
            let newCreatedConversation = this.conversationChangesData('add');
            newCreatedConversation.setDepth(response.getParent().getDepth() + 1);
            this.conversationChangesUI('add', newCreatedConversation.getUuid());
            this.addSvgConnectorLinesData(newCreatedConversation.getUuid(), $currentResponse.data('id'));
            this.drawSvgConnectorLinesUI();
            this.adjustCanvasSize();
            // clean error if it has
            $currentResponse.removeClass('error');
        });

        this.$container.on('keyup', '.response-text textarea', (e) => {
            const $target = $(e.target);
            const text = $target.val().toString().trim();
            const $currentResponse = $target.closest('.response_template__js');
            const $currentConversation = $target.closest('.conversation_template__js');
            // Data related to elements' IDs
            this.responseChangesData('update', $currentConversation.data('id'), $currentResponse.data('id'), text);
        });

        this.$container.on('focusin', '.conversation_template__js textarea', (e) => {
            const $target = $(e.target);
            const $currentConversation = $target.closest('.conversation_template__js');
            $currentConversation.addClass('editing');
            this.$svgContainer.css('z-index', ConversationEditor.LAYER_ACTIVE_SVG);
        });

        this.$container.on('focusout', '.conversation_template__js textarea', (e) => {
            const $target = $(e.target);
            const $currentConversation = $target.closest('.conversation_template__js');
            $currentConversation.removeClass('editing');
            this.$svgContainer.css('z-index', ConversationEditor.LAYER_DEFAULT);
        });

        this.$container.on('click', '.connector', (e) => {
            e.preventDefault();
            const $target = $(e.target);
            if ($('.connector.active').length > 1 ||
                ($target.hasClass('before') && $('.connector.active.before').length) ||
                ($target.hasClass('after') && $('.connector.active.after').length)) {
                $('.connector').removeClass('active');
            }
            $target.toggleClass('active');
            isBeforeClicked = $('.connector.after').hasClass('active');
            isAfterClicked = $('.connector.before').hasClass('active');
            if (isBeforeClicked && isAfterClicked) {
                const $boxBefore = $('.connector.active.before');
                const $boxAfter = $('.connector.active.after');
                const conversationID = $boxBefore.data('id');
                const responseID = $boxAfter.data('id');
                // prevent circled loop
                if (!this.isConnectionValid(conversationID, responseID)) {
                    $('.connector').removeClass('active');
                    alert("This connecting will cause conversations playback, please select another one.");
                    return;
                }
                this.addSvgConnectorLinesData(conversationID, responseID);
                this.drawSvgConnectorLinesUI();
                // remove active box after connected
                $('.connector').removeClass('active');
                // remove error if error class
                $boxBefore.closest('.conversation_template__js').removeClass('error');
                $boxAfter.closest('.response_template__js').removeClass('error');
            }
        });

        // canvas path or setting symbol click
        this.$canvas.on('click', '.svg_container .line, .svg_container .symbol, .svg_container .settingCircle', (event) => {
            const $lineGroup = $(event.target).closest('.lineGroup');
            const id = $lineGroup.attr('id');
            this.$svgContainer.find('lineGroup').removeClass('active');
            $lineGroup.addClass('active');
            this.animateRelationshipBoxIn(id, event);
        });

        this.$canvas.on('input', '.conversation_context_container .conversation_context_input', (e) => {
            let id = $(e.target).closest('.conversation_template__js').data('id');
            let text = $(e.target).val().toString().trim();
            this.conversationChangesData('update', id, text);
        });

        this.$canvas.on('click', '.trash-conversation-btn', (e) => {
            let conversationId = $(e.target).closest('.conversation_template__js').data('id');
            let isConversationsValid = this.validateConversations();
            let isConversationPositive = this.conversations.get(conversationId).getDepth() > 0;
            if (isConversationPositive && !isConversationsValid) {
                alert(ConversationEditor.INVALID_CONVERSATION_MSG);
                return;
            }

            if (!isConversationPositive) {
                this.conversationRemovalHandler(conversationId, isConversationsValid);
                return;
            }
            let r = confirm("Are you sure to remove this conversation?");
            if (r == true) {
                this.conversationRemovalHandler(conversationId, isConversationsValid);
            }
        });

        this.$canvas.on('click', (e) => {
            const $target = $(e.target);

            // unselect path
            if (!$target.is('path')) {
                this.triggerRelationshipConfigForm();
            }
        });

        this.$modalContainer.on('click', '.character-avatar', (e) => {
            if (this.avatarChangeLocker) {
                return;
            }

            this.avatarChangeLocker = true;
            const $target = $(e.target);
            const currentExpression = $target.attr('alt');
            const nextExpression = ConversationEditor.getNextExpression(currentExpression);
            $target.attr({
                'src': $target.attr('src').replace(currentExpression, nextExpression),
                'alt': nextExpression
            });

            let conversation = this.conversations.get($target.closest('.conversation_template__js').data('id'));
            conversation.setExpressionName(nextExpression);
            conversation.updateExpression();

            setTimeout(() => {
                this.avatarChangeLocker = false;
            }, 500);
        });

        // modal
        this.$modalContainer.on('click', '.add-conversation-point-btn', (e) => {
            e.preventDefault();
            // prevent ui change when the scale is not normal
            if (this.zoomed) {
                $('#zoom-reset').trigger('click');
            }
            let newCreatedConversation = this.conversationChangesData('add');
            this.conversationChangesUI('add', newCreatedConversation.getUuid());
        });

        this.$modalContainer.on('click', '.tidy-conversation-btn', (e) => {
            e.preventDefault();
            // prevent ui change when the scale is not normal
            if (this.zoomed) {
                $('#zoom-reset').trigger('click');
            }
            // validating
            if (!this.validateConversations()) {
                // show alert
                alert(ConversationEditor.INVALID_CONVERSATION_MSG);
                return;
            }
            this.tidyConversations();
            // close relationship config
            this.triggerRelationshipConfigForm();
        });

        // behaviors
        $('#zoom-reset').off().on('click', (e) => {
            e.preventDefault();
            this.resetZoomView();
            // reset guide text
        });

        // relationship popup
        this.$relationship_config.on('submit', 'form', (e) => {
            e.preventDefault();
            let newWeight = Number(this.$relationship_config.find('input[name="weight"]').val());
            let newPoints = Number(this.$relationship_config.find('input[name="points"]').val());
            this.editingRelationship.setWeight(newWeight);
            this.editingRelationship.setPoints(newPoints);
            this.connectorLines.set(this.editingRelationship.getId(), this.editingRelationship);
            this.closeRelationshipBox();
        });

        this.$relationship_config.on('click', '#relationship_config_delete', (e) => {
            e.preventDefault();
            if (this.$relationship_config.is(':visible') && this.editingRelationship) {
                this.checkAndRemoveRelationship();
            }
        });

        this.$relationship_config.on('click', '.close__js', (e) => {
            e.preventDefault();
            this.closeRelationshipBox();
        });

        this.$relationship_config_mask.on('click', (e) => {
            e.preventDefault();
            this.closeRelationshipBox();
        });

        this.$finishBtn.on('click', () => {
            if (!this.validateConversations()) {
                // show alert
                alert(ConversationEditor.INVALID_CONVERSATION_MSG);
                return;
            }
            if (!this.validateResponses()) {
                return;
            }
            this.triggerRelationshipConfigForm();
            this.compileRevisionData();
            this.$modalContainer.modal('hide');
            $('body').removeClass('modal-open');
        });

        // outer modal triggers
        $('#scenario_draw_modal_btn').on('click', () => {
            this.$modalContainer.modal('show');
        });
    }

    /**
     * give a conversation id and let screen auto scroll to the center of it to focus
     * @param conversationID
     */
    private autoScrollToAConversationCenter(conversationID: string) {
        const $conversation = $(`.conversation_templates.conversation_template__js[data-id="${conversationID}"]`);
        let scrollToPosition = ConversationEditor.calculateScrollPosition($conversation);
        this.$canvas.parent().get(0).scrollTo(scrollToPosition[0] + ConversationEditor.CONVERSATION_LEFT_TOP_OFFSET, scrollToPosition[1] + ConversationEditor.CONVERSATION_LEFT_TOP_OFFSET);
    }

    /**
     * calculate a position to scroll to make element inside of centre screen
     */
    private static calculateScrollPosition($el): any {
        let position = $el.position();
        let windowWidth = window.innerWidth - ConversationEditor.CONVERSATION_WIDTH;
        let windowHeight = window.innerHeight - ConversationEditor.CONVERSATION_HEIGHT;
        return [position.left - windowWidth / 2, position.top - windowHeight / 2];
    }

    /**
     * reset zoom view port
     */
    private resetZoomView() {
        this.zoomed = false;
        // reset d3 zoom storage
        let zoom = d3.zoom().on("zoom", this.canvasZoomed);
        zoom.transform(d3.select('#scenario_drawer_container'), d3.zoomIdentity);
        // show zoom scale text
        $('#zoom-percentage').text('100');
        // hide canvas mask
        this.$canvasMask.addClass('hidden');
    }

    /**
     * tidy conversations group
     */
    private tidyConversations() {
        // reset stacks
        this.iterationMaxDepth = 0;
        this.drawConversations = new Set<string>();
        this.negativeConversations = new Set<Conversation>();
        this.conversationStack = new Map<number, number>();
        this.responseStack = new Map<number, number>();
        // store relationship position into cache to improve drag calculation performance
        this.relationshipCurveLinesCache = new Map<string, string>();
        this.connectorPositionCache = new Map<string, [number, number]>();
        this.relationshipPositionCache = new Map<string, [number, number][]>();
        // clean content
        this.$svgContainer.siblings().not('.canvas-mask').remove();
        this.recursiveDrawConversations(this.rootConversation);
        this.decorateConnectorBoxes();
        this.redrawSvgConnectorLines();
        this.adjustCanvasSize();
        this.setupCanvasUIDraggableBehaviours();
    }

    /**
     * submit relation ship config form
     */
    private triggerRelationshipConfigForm() {
        if (this.$relationship_config.is(':visible')) {
            this.$relationship_config.find('#relationship_config_close').trigger('click');
        }
    }

    /**
     * Revision Sanitize conversations config data
     * revision data is from server, we sanitize it into our objects type
     */
    private sanitizeConfigurationData() {
        let {scenarioData} = this.config;
        let {questions} = this.config;
        // if created new, auto build an empty root conversation for it
        if (!scenarioData && !questions) {
            this.rootConversation = new Conversation();
            this.conversations.set(this.rootConversation.getUuid(), this.rootConversation);
            return;
        }

        let {relationships} = scenarioData;
        // handle old data by checking is relationships created
        if (relationships) {
            let {conversations} = scenarioData;
            let {responses} = scenarioData;
            this.iterativeBuildConversations(conversations, responses);
            this.buildRelationships(relationships);
        } else {
            // [OLD DATA STRUCTURE]
            // build data for old config version, no scenarioData existing but 'questions'
            this.oldQuestionDataHandler(questions);
            // loop again to build relationship because it needs all conversations created first then use its id to connect
            this.buildRelationshipsFromOldData(questions);
        }
    }

    /**
     * load relationship data from config data - assign weight/points
     */
    private buildRelationships(relationships) {
        if (!relationships || !relationships.length) {
            return;
        }
        relationships.forEach((relationshipObj: any) => {
            const combID: string = relationshipObj.id;
            let conversation = this.getConversationById(relationshipObj['conversation_id']);
            let response = this.getResponseById(relationshipObj['response_id']);
            let newRelationship = new RelationshipLine(combID, conversation, response, relationshipObj.weight, relationshipObj.points);
            this.connectorLines.set(combID, newRelationship);
        });
    }

    /**
     * Build Conversation Way One:  O(log n)
     * Recursively build conversation object based on the config json data
     */
    private recursiveBuildConversations(conversationObj: any): Conversation {
        let conversationID = conversationObj['id'] || '';
        if (this.conversations.has(conversationID)) {
            return this.conversations.get(conversationID);
        }
        let depth = conversationObj['depth'];
        let conversation = new Conversation(depth);
        if (conversationID) {
            conversation.setUuid(conversationID);
        }
        conversation.setAssets(conversationObj['expression_name'], conversationObj['expression_url'], conversationObj['context']);
        if (conversationObj.hasChildren) {
            conversationObj['response_children'].forEach((responseObj: any) => {
                let responseID = responseObj['id'];
                let response = new Response(conversation, responseObj['text']);
                response.setUuid(responseID);
                response.setParent(conversation);
                if (responseObj.hasChildren) {
                    responseObj['conversation_children'].forEach((subConversationObj: any) => {
                        let createdConversation = this.recursiveBuildConversations(subConversationObj);
                        // add child
                        response.addConversation(createdConversation);
                        // refer parent
                        createdConversation.addParentResponse(response);
                    });
                }
                conversation.addResponse(response);
                this.responses.set(responseID, response);
            })
        }
        this.conversations.set(conversation.getUuid(), conversation);
        return conversation;
    }

    /**
     * Build Conversation Way Two:  O(n^2 * 2)
     * Recursively loop into conversation object list and build objects.
     */
    private iterativeBuildConversations(conversations: any, responses: any) {
        conversations.forEach((conversationObj) => {
            let conversationID = conversationObj['id'];
            let depth = conversationObj['depth'];
            let conversation = new Conversation(depth);
            conversation.setUuid(conversationID);
            conversation.setAssets(conversationObj['expression_name'], conversationObj['expression_url'], conversationObj['context']);
            if (depth === 0) {
                this.rootConversation = conversation;
            }
            this.conversations.set(conversation.getUuid(), conversation);
        });

        responses.forEach((responseObj) => {
            // after all conversations created, we should be able to get one of them by id
            let responseID = responseObj['id'];
            let conversationParentID = responseObj['parent_id'];
            let conversationParent = this.conversations.get(conversationParentID);
            let response = new Response(conversationParent, responseObj['text']);
            response.setUuid(responseID);

            // link conversation children
            responseObj['children_ids'].forEach((conversationID: any) => {
                let conversationChild = this.conversations.get(conversationID);
                conversationChild.addParentResponse(response);
                response.addConversation(conversationChild);
                // update child conversation
                this.conversations.set(conversationID, conversationChild);
            });

            // update parent conversation
            conversationParent.addResponse(response);
            this.conversations.set(conversationParentID, conversationParent);

            // update response itself
            response.setParent(conversationParent);
            this.responses.set(responseID, response);
        });
    }

    /**
     * First, we have data in ts version then we need to compile them into revision required json format to store
     */
    private compileRevisionData() {
        // default
        let relationships = [];
        // loop
        this.connectorLines.forEach((relationship: RelationshipLine) => {
            relationships.push(relationship.toJSON());
        });
        this.revisionData = {
            relationships: relationships,
            conversations: Array.from(this.conversations.values()).map(conversation => conversation.toJSON()),
            responses: Array.from(this.responses.values()).map(response => response.toJSON()),
        };
    }

    /**
     * Get compiled config data
     */
    public getCompiledRevisionData(): any {
        if (!this.revisionData) {
            this.compileRevisionData();
        }

        return this.revisionData;
    }

    /**
     * close setting box and reset z-index
     */
    public closeRelationshipBox() {
        this.editingRelationship = null;
        this.$svgContainer.find('g.active').removeClass('active');
        this.$container.children('.canvas-container').removeClass('config-open');
        this.$relationship_config.css({
            'z-index': ConversationEditor.LAYER_HIDDEN,
            'display': 'none'
        });
    }

    /**
     * animate setting box in after setting icon or line being clicked
     */
    public animateRelationshipBoxIn(relationshipID: string, event: any) {
        // ui
        this.$container.children('.canvas-container').addClass('config-open');
        this.$relationship_config.css({
            'z-index': ConversationEditor.LAYER_ON_TOP,
            'top': event.offsetY,
            'left': event.offsetX,
        });

        this.editingRelationship = this.connectorLines.get(relationshipID);
        this.renderRelationshipConfig();
        this.$relationship_config.css({display: 'block'});
        $('#relationship_config_form').validate();
    }

    /**
     * Render relationship config box according to the current editing relationship object data
     */
    private renderRelationshipConfig() {
        this.$relationship_config.find('input[name="weight"]').val(this.editingRelationship.getWeight());
        this.$relationship_config.find('input[name="points"]').val(this.editingRelationship.getPoints());
        // ...
    }

    /**
     * check the relation ship is removable and execute
     */
    private checkAndRemoveRelationship() {
        let response = this.editingRelationship.getAfter();
        let conversation = this.editingRelationship.getBefore();
        let hasMultiParent = conversation.getParents().size > 1;
        if (!hasMultiParent) {
            alert("You need to connect this conversation to another response before deleting this relationship.");
            return;
        }

        let r = confirm("Are you sure to remove this relationship?");
        if (r == true) {
            this.connectorLines.delete(this.editingRelationship.getId());
            response.removeConversation(conversation);
            conversation.removeParentResponse(response);
            // adjust depth
            conversation.setDepth(ConversationEditor.retrieveDepthFromParent(conversation));
            // reset form
            this.closeRelationshipBox();
        }

        this.redrawSvgConnectorLines();
    }

    /**
     * parent conversation's depth are known, use parent's to calculate sub conversation's depth
     */
    private static retrieveDepthFromParent(conversation: Conversation): number {
        let availableParent: Response = Array.from(conversation.getParents()).shift();
        let parentDepth = availableParent.getParent().getDepth();
        return parentDepth + 1;
    }

    /**
     * only 'root' we needed, recursively loop into the deepest one and connect them together
     */
    public drawSvgConnectorLinesUI() {
        // store relationship position into cache to improve drag calculation performance
        this.relationshipCurveLinesCache = new Map<string, string>();
        this.connectorPositionCache = new Map<string, [number, number]>();
        this.relationshipPositionCache = new Map<string, [number, number][]>();

        let linesData = Array.from(this.connectorLines.values()) || [];

        // read&record positions
        this.readRelationshipGraphicsData();

        let lineGroups = this.lineDrawsGroup.selectAll('.lineGroup')
            .data(linesData)
            .enter()
            .append("g");

        lineGroups.attr('class', "lineGroup")
            .attr("id", (data) => {
                return data.getId();
            });

        let lines = lineGroups.append('path');
        let settings = lineGroups.append('path');
        let settingCircles = lineGroups.append('circle');

        this.assignLinesAttributes(lines);
        this.assignLinesSettingAttributes(settings);
        this.assignLinesSettingCircleAttributes(settingCircles);
        // decorate connectors to indicates 1:1 ? 1:n ? n:n
        this.decorateConnectorBoxes();
    }

    /**
     * Decorate connectors to indicates 1:1 ? 1:n ? n:n
     */
    private decorateConnectorBoxes() {
        this.conversations.forEach((conversation: Conversation) => {
            let $connector = $(`.connector.before[data-id=${conversation.getUuid()}]`);
            let hasMulti = conversation.hasMultiParents();
            $connector.toggleClass('single', !hasMulti);
            $connector.toggleClass('multi', hasMulti);
        });

        this.responses.forEach((response: Response) => {
            let $connector = $(`.connector.after[data-id=${response.getUuid()}]`);
            let hasMulti = response.hasMultiChildren();
            $connector.toggleClass('single', !hasMulti);
            $connector.toggleClass('multi', hasMulti);
        });
    }

    /**
     * According to conversation id, find its related relationship lines(including responses'), clean their cache
     */
    private cleanConversationRelatedCache(conversationID: string) {
        let conversation = this.conversations.get(conversationID);
        this.connectorPositionCache.delete(conversationID);
        if (!conversation) {
            return
        }

        let relationships = Array.from(this.relationshipPositionCache.keys());
        if (!relationships.length) {
            return;
        }

        relationships.forEach((combID: string) => {
            if (combID.includes(conversationID)) {
                this.relationshipPositionCache.delete(combID);
            }
        });

        let relatedResponses = conversation.getResponses();
        if (!relatedResponses.size) {
            return;
        }

        // relatedResponses size is small which <= 4

        // O( 4 *  relationships.length ) same as another way
        relatedResponses.forEach((response: Response) => {
            let responseID = response.getUuid();
            this.connectorPositionCache.delete(responseID);
            relationships.forEach((combID: string) => {
                if (combID.includes(responseID)) {
                    this.relationshipPositionCache.delete(combID);
                }
            });
        });
    }

    /**
     * redraw existing lines on drag
     * line & setting d3 svg integrated updating, see https://www.d3indepth.com/enterexit/
     */
    private redrawSvgConnectorLines() {
        let connectorLines = Array.from(this.connectorLines.values());

        // read & record positions
        this.readRelationshipGraphicsData();

        // lines
        let lines = this.lineDrawsGroup.selectAll(".line").data(connectorLines);
        lines.exit().remove();
        lines.enter().append("path");

        // lines' setting
        let settings = this.lineDrawsGroup.selectAll(".symbol").data(connectorLines);
        settings.exit().remove();
        settings.enter().append("path");

        // lines' setting circles
        let settingCircles = this.lineDrawsGroup.selectAll(".settingCircle").data(connectorLines);
        settingCircles.exit().remove();
        settingCircles.enter().append("circle");

        this.assignLinesAttributes(lines);
        this.assignLinesSettingAttributes(settings);
        this.assignLinesSettingCircleAttributes(settingCircles);
    }

    private readRelationshipGraphicsData() {
        this.connectorLines.forEach((relationship: RelationshipLine) => {
            let lineData = this.fetchSingleLineData(relationship);
            this.relationshipCurveLinesCache.set(relationship.getId(), ConversationEditor.compileCurveLineData(lineData));
        });
    }

    /**
     * shared method to set line's attributes - id, weight, points
     * @param lines
     */
    private assignLinesAttributes(lines: any) {
        lines.attr("class", "line")
            .attr("stroke-width", 2)
            .attr("stroke", (data) => {
                return data.getColor();
            })
            .attr("d", (data) => {
                return this.relationshipCurveLinesCache.get(data.getId());
            });
    }

    /**
     * use setting line data to fetch setting position and draw
     */
    private assignLinesSettingAttributes(settings: any) {
        settings.attr("class", "symbol")
            .attr("stroke-width", 1)
            .attr("stroke", (data) => {
                return data.getColor();
            })
            .attr("d", () => {
                return SETTING_ICON_SVG_STRING;
            })
            .attr("transform", (data) => {
                let relationshipID = data.getId();
                let middlePoint = this.getMidddlePointForSetting(this.relationshipPositionCache.get(relationshipID));
                return `translate(${middlePoint[0]}, ${middlePoint[1]})`
            });
    }

    private assignLinesSettingCircleAttributes(settingCircles: any) {
        settingCircles.attr("class", "settingCircle")
            .attr("r", function () {
                return 4;
            })
            .attr("transform", (data) => {
                let relationshipID = data.getId();
                let middlePoint = this.getMidddlePointForSetting(this.relationshipPositionCache.get(relationshipID), false);
                return `translate(${middlePoint[0]}, ${middlePoint[1]})`
            })
            .style("fill", function (d) {
                return d.getColor();
            });
    }

    /**
     * After we get two points [from,to], we'll need [from,middle,to] to draw setting icon
     */
    private getMidddlePointForSetting(lineData: [number, number][], countRadius: boolean = true): number[] {
        let startPoint = lineData[0];
        let endPoint = lineData[1];
        let radius = countRadius ? ConversationEditor.SVG_CIRCLE_RADIUS : 0;
        let xMiddle = (startPoint[0] + endPoint[0]) / 2 - radius;
        let yMiddle = (startPoint[1] + endPoint[1]) / 2 - radius;

        return [xMiddle, yMiddle];
    }

    /**
     *  Fetch single relationship line data
     *  store relationship position into cache to improve drag calculation performance
     */
    private fetchSingleLineData(relationship: RelationshipLine): [number, number][] {
        let afterID = relationship.getAfter().getUuid();
        let beforeID = relationship.getBefore().getUuid();
        const boxBefore = $(`.connector.before[data-id="${beforeID}"]`);
        const boxAfter = $(`.connector.after[data-id=${afterID}]`);
        if (this.relationshipPositionCache.has(relationship.getId())) {
            return this.relationshipPositionCache.get(relationship.getId());
        }

        const lineData = this.calculateConnectorLineData(boxBefore, boxAfter, beforeID, afterID);
        this.relationshipPositionCache.set(relationship.getId(), lineData);
        return lineData;
    }

    /**
     * line data generator that separate one line to three, e.g M1070,770 C977,770 977,904.5 884,904.5;
     * @param lineData
     */
    private static compileCurveLineData(lineData: [number, number][]): string {
        let startPoint = lineData[0];
        let endPoint = lineData[1];
        let xMiddle = (startPoint[0] + endPoint[0]) / 2;
        return `M${endPoint[0]},${endPoint[1]} C${xMiddle},${endPoint[1]} ${xMiddle},${startPoint[1]} ${startPoint[0]},${startPoint[1]}`;
    }

    /**
     * remove a group array of responses
     */
    private removeGroupResponses(responses: Response[]) {
        responses.forEach((response: Response) => {
            this.responses.delete(response.getUuid());
        });
    }

    /**
     * remove relationships once a response/conversation has been removed
     * @param removalID: string
     */
    private updateRelationshipOnRemoval(removalID: string) {
        this.connectorLines.forEach((relationship: RelationshipLine, combID: string) => {
            if (combID.includes(removalID)) {
                this.connectorLines.delete(combID);
            }
        });
    }

    /**
     * returns calculated position [[x1, y1]&[x2, y2]]
     * @param boxBefore
     * @param boxAfter
     * @param beforeID
     * @param afterID
     */
    private calculateConnectorLineData(boxBefore: JQuery<HTMLElement>, boxAfter: JQuery<HTMLElement>, beforeID: string, afterID: string): [number, number][] {
        if (!boxBefore.length || !boxAfter.length) {
            return [];
        }

        let startPos: [number, number];
        let endPos: [number, number];

        // load cache if already set  start/end
        if (this.connectorPositionCache.has(afterID)) {
            startPos = this.connectorPositionCache.get(afterID);
        } else {
            // calc start position
            let conversationAfterPos = boxAfter.closest('.conversation_template__js').position();
            let afterPos = boxAfter.position();
            let wrapperAfterPos = boxAfter.parent().position();
            let startX = conversationAfterPos.left + wrapperAfterPos.left + afterPos.left + ConversationEditor.CONVERSATION_CONNECTOR_WIDTH + ConversationEditor.CONVERSATION_LEFT_TOP_OFFSET;
            let startY = conversationAfterPos.top + wrapperAfterPos.top + afterPos.top + ConversationEditor.CONVERSATION_CONNECTOR_WIDTH + ConversationEditor.CONVERSATION_LEFT_TOP_OFFSET;
            startPos = [startX, startY];
            this.connectorPositionCache.set(afterID, startPos);
        }

        if (this.connectorPositionCache.has(beforeID)) {
            endPos = this.connectorPositionCache.get(beforeID);
        } else {
            // calc end position
            let wrapperBeforePos = boxBefore.parent().position();
            let beforePos = boxBefore.position();
            let endX = wrapperBeforePos.left + beforePos.left + ConversationEditor.CONVERSATION_LEFT_TOP_OFFSET;
            let endY = wrapperBeforePos.top + beforePos.top + 10 + ConversationEditor.CONVERSATION_LEFT_TOP_OFFSET;
            endPos = [endX, endY];
            this.connectorPositionCache.set(beforeID, endPos);
        }

        return [startPos, endPos];
    }

    /**
     * check if a connecting behavior valid, for example: prevent user to do circled conversation loops.
     */
    private isConnectionValid(conversationID: string, responseID: string): boolean {
        let isValid = true;
        const RESPONSE_TO_CHECK = this.responses.get(responseID);
        const conversation = this.conversations.get(conversationID);
        let loopExists = this.recursiveCheckConversationLooper(conversation, RESPONSE_TO_CHECK);
        if (loopExists) {
            return false;
        }

        return isValid;
    }

    /**
     * Recursive way to check from the connecting conversation until the deepest and compare the responses to prevent circled loop.
     * @param conversation
     * @param RESPONSE_TO_CHECK
     */
    private recursiveCheckConversationLooper(conversation: Conversation, RESPONSE_TO_CHECK: Response): boolean {
        // start from the conversation, counting down each response to the deepest one
        let currentResponses = conversation.getResponses();
        let isLoopExist = false;
        currentResponses.forEach((response: Response) => {
            let nextLevelConversations = response.getConversations();
            let isLoopExistInTheDeep = false;
            let isLoopExistInCurrent = response === RESPONSE_TO_CHECK;

            nextLevelConversations.forEach((conversation: Conversation) => {
                let isLoopExistInRollingDeep = this.recursiveCheckConversationLooper(conversation, RESPONSE_TO_CHECK);
                if (isLoopExistInRollingDeep) {
                    isLoopExist = true;
                    return false;
                }
            });

            if (isLoopExistInTheDeep || isLoopExistInCurrent) {
                isLoopExist = true;
                return false;
            }
        });

        return isLoopExist;
    }

    /**
     * add relationship between response and conversation
     * @param beforeID
     * @param afterID
     */
    private addSvgConnectorLinesData(beforeID: string, afterID: string): void {
        // root never has parent
        if (beforeID === this.rootConversation.getUuid()) {
            return;
        }

        // add into response's children
        let conversation = this.getConversationById(beforeID);
        let response = this.getResponseById(afterID);

        // no connect to itself
        if (conversation.getUuid() === response.getParent().getUuid()) {
            return;
        }

        // push into lines array
        const combID: string = `comb_${beforeID}_${afterID}`;
        let newRelationShip = new RelationshipLine(combID, this.getConversationById(beforeID), this.getResponseById(afterID));
        this.connectorLines.set(combID, newRelationShip);

        // give the response relationship to new created conversation
        if (conversation && response) {
            response.addConversation(conversation);
            conversation.addParentResponse(response);
            // give depth
            let nextDepth = response.getParent().getDepth() + 1;
            let maxDepth = Math.max(nextDepth, conversation.getDepth());
            conversation.setDepth(maxDepth);
        }
    }

    /**
     * remove relationship between response and conversation
     * @param beforeID
     * @param afterID
     */
    private removeSvgConnectorLinesData(beforeID: string, afterID: string): void {
        // remove freom lines array
        const combID: string = `comb_${beforeID}_${afterID}`;
        this.connectorLines.delete(combID);
        // remove response's
        let conversation = this.getConversationById(beforeID);
        let response = this.getResponseById(afterID);
        if (conversation && response) {
            response.removeConversation(conversation);
        }
    }

    /**
     * Show guide text on the guide panel
     * Default is 2nd guide [1]
     * @param step
     * @param type
     */
    private showGuideText(step: number = 1, type: string = 'info'): void {
        let text = ConversationEditor.GUIDE_STEPS[step] || '';
        let background = '#0fe67a'; // default guide color
        let text_color = '#000'; // default guide color

        switch (type) {
            case 'info':
                background = '#0fe67a';
                break;
            case 'warn':
                background = '#d9edf7';
                break;
            case 'alert':
                text_color = '#fff';
                background = '#f75676';
                break;
        }

        this.$guideTipsBlock.css({'background-color': background, 'color': text_color});
        this.$guideTipsText.text(text);
        if (type === 'alert') {
            setTimeout(() => {
                this.showGuideText();
            }, 2000);
        }
    }

    /**
     * using d3 drag to make the conversation items draggable
     */
    private setupCanvasUIDraggableBehaviours() {
        let self = this;
        let dragging = false;
        let initialX;
        let initialY;
        let currentX;
        let currentY;
        let position;
        let canvasWidth = this.$canvas.width();
        let canvasHeight = this.$canvas.height();

        d3.selectAll('.conversation_template__js').call(d3.drag()
            .filter(function () {
                return d3.event.path[0].classList.contains('start-text-wrap');
            })
            .on('drag', function () {
                let sourceEvent = d3.event.sourceEvent;
                currentX = sourceEvent.clientX - initialX;
                currentY = sourceEvent.clientY - initialY;
                let moveToLeft = position.left + currentX;
                let moveToTop = position.top + currentY;
                if (moveToLeft <= 0 || moveToTop <= 0) {
                    return;
                }
                $(this).css({left: moveToLeft, top: moveToTop});
                // clean conversation related relationship position cache before redraw
                self.cleanConversationRelatedCache($(this).data('id'));
                self.redrawSvgConnectorLines();
            })
            .on('end', function () {
                dragging = false;
                initialX = currentX = 0;
                initialY = currentY = 0;
                position = null;
                // adjust canvas if exceed
                let extendWidth = $(this).position().left + ConversationEditor.CONVERSATION_WIDTH;
                let extendHeight = $(this).position().top + ConversationEditor.CONVERSATION_HEIGHT;
                if (extendWidth > canvasWidth) {
                    self.$canvas.width(Math.max(canvasWidth, extendWidth));
                }
                if (extendHeight > canvasHeight) {
                    self.$canvas.height(Math.max(canvasWidth, extendHeight));
                }
                self.$svgContainer.css('z-index', ConversationEditor.LAYER_DEFAULT);
                $(this).css('z-index', ConversationEditor.LAYER_CONVERSATION);
            })
            .on('start', function () {
                dragging = true;
                let sourceEvent = d3.event.sourceEvent;
                // record current position
                position = $(this).position();
                initialX = sourceEvent.clientX;
                initialY = sourceEvent.clientY;
                self.$svgContainer.css('z-index', ConversationEditor.LAYER_ACTIVE_SVG);
                $(this).css('z-index', ConversationEditor.LAYER_ON_TOP);
            })
        );
    }

    /**
     * canvas zoomed common arrow function for d3 zoom
     */
    private canvasZoomed = () => {
        let transformData = d3.event.transform;
        let scale = transformData.k;
        this.zoomed = scale !== 1;
        let translateW = this.$canvas.width() / 2;
        let translateH = this.$canvas.height() / 2;
        let translateX = (1 - scale) * -translateW;
        let translateY = (1 - scale) * -translateH;
        this.$canvasMask.toggleClass('hidden', scale === 1);
        this.$canvas.css({transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`});
        $('#zoom-percentage').text(Math.floor(scale * 100));
    };

    /**
     * using d3 zoom to make the canvas zoomable
     */
    private setupCanvasUIZoomableBehaviours() {
        d3.select('#scenario_drawer_container').call(d3.zoom()
            .scaleExtent([1 / 10, 1])
            .filter(() => {
                if (d3.event.type === 'wheel') {
                    // don't allow zooming without pressing [ctrl] key
                    return d3.event.ctrlKey;
                }
                return true;
            })
            .on("zoom", this.canvasZoomed));
    }

    /**
     * General method to initialize maps and get ready for data create and draw
     */
    private buildMapList() {
        this.iterationMaxDepth = 0;
        this.conversations = new Map<string, Conversation>();
        this.drawConversations = new Set<string>();
        this.negativeConversations = new Set<Conversation>();
        this.responses = new Map<string, Response>();
        this.conversationStack = new Map<number, number>();
        this.responseStack = new Map<number, number>();
        this.connectorLines = new Map<string, RelationshipLine>();
        this.lineDrawsGroup = this.svgContainer.append("g").attr("class", "groupWrap");

        this.sanitizeConfigurationData();
        this.recursiveDrawConversations(this.rootConversation);
        this.adjustCanvasSize();
    }

    /**
     * Recursively loop into deepest conversation to draw, the root conversation doesn't have parent response
     * @param conversation
     */
    private recursiveDrawConversations(conversation: Conversation): void {
        // multiple response may have one conversation to connect but responses only belongs one conversation
        // avoid duplicated draw
        if (this.drawConversations.has(conversation.getUuid())) {
            return;
        }
        // draw a single conversation according to the loop data
        this.drawSingleConversation(conversation);
        this.drawConversations.add(conversation.getUuid());
        // record depth and go to deeper
        this.iterationMaxDepth = Math.max(this.iterationMaxDepth, conversation.getDepth());
        conversation.getResponses().forEach((response: Response) => {
            response.getConversations().forEach((conversation: Conversation) => {
                this.recursiveDrawConversations(conversation);
            })
        });
    }

    /**
     * Automatically adjust canvas size with the content change
     * e.g it can be used for drag to extend canvas size
     */
    private adjustCanvasSize() {
        const conversationStacks = Math.max(...Array.from(this.conversationStack.values()));
        const responseStacks = Math.max(...Array.from(this.responseStack.values()));

        const totalDepth = this.conversationStack.size;
        // x: (depth + 1) * conversation width * spaces
        let maxX = (totalDepth + 1) * (ConversationEditor.CONVERSATION_WIDTH + ConversationEditor.CONVERSATION_SPACE_X);


        // y: calculate each level's conversation & response stacks to get maximum height, level height : Map<level, height>
        let levelHeight = new Map<number, number>();

        // depth will start at 0 - the root conversation
        for (let i = 0; i < totalDepth; i++) {
            let currentConversationStacks = this.conversationStack.get(i);
            let currentResponseStacks = this.responseStack.get(i) || 0;  // it's possible no responses but conversations when drawing
            // spaces happens between conversations
            let totalSpaces = currentConversationStacks > 1 ?
                (currentConversationStacks - 1) * ConversationEditor.CONVERSATION_SPACE_Y : currentConversationStacks * ConversationEditor.CONVERSATION_SPACE_Y;
            let currentHeight = currentConversationStacks * ConversationEditor.CONVERSATION_HEIGHT +
                currentResponseStacks * ConversationEditor.RESPONSE_HEIGHT +
                totalSpaces;
            levelHeight.set(i, currentHeight);
        }
        // y: select maximum height of each depth - plus edge padding
        let maxY = Math.max(...Array.from(levelHeight.values())) + ConversationEditor.CONVERSATION_SPACE_Y;

        // min w&h = min window size
        let edgeWidth = Math.max(maxX, window.innerWidth);
        let edgeHeight = Math.max(maxY, window.innerHeight);

        // mini size 1024x1024
        this.$canvas.width(`${edgeWidth}px`);
        this.$canvas.height(`${edgeHeight}px`);
    }

    /**
     * This method is used to draw a single conversation by passing conversation object in
     * it will automatically calculate the position depends on its depth and responses stacks
     * @param conversation
     */
    private drawSingleConversation(conversation: Conversation) {
        let position = this.calculateConversationPosition(conversation);
        let tempConversationStacksNum = this.negativeConversations.size;
        if (tempConversationStacksNum) {
            const stackSpace = tempConversationStacksNum * ConversationEditor.CONVERSATION_STACK_SPACE_TEMP;
            position.top = position.top + stackSpace;
            position.left = position.left + stackSpace;
        }
        // The radius
        let conversationTemplate = nunjucks.renderString(this.conversationRenderString, conversation.toJSON());
        $(conversationTemplate).css(position)
            .toggleClass('conversation_start', conversation.getDepth() === 0)
            .appendTo(this.$canvas);
    }

    /**
     * this method is used to calculate the position data {left:?: top:?}
     * @param conversation
     */
    private calculateConversationPosition(conversation: Conversation): any {
        let position = {
            left: 0,
            top: 0
        };
        // The stack of conversations width: x - depth
        let depth = conversation.getDepth();
        if (depth < 0) {
            this.negativeConversations.add(conversation);
            const addPointsBtnPosition = $('.add-conversation-point-btn').offset();
            // 40, 50 - adjust position to the corner
            return {
                left: addPointsBtnPosition.left - 40 + this.$canvas.parent().prop('scrollLeft') - ConversationEditor.CONVERSATION_LEFT_TOP_OFFSET,
                top: addPointsBtnPosition.top - ConversationEditor.CONVERSATION_HEIGHT - 50 + this.$canvas.parent().prop('scrollTop') - ConversationEditor.CONVERSATION_LEFT_TOP_OFFSET
            };
        }
        // The stack of conversations height: y - stack
        let currentConversationStack = this.conversationStack.get(depth) || 0;
        this.conversationStack.set(depth, currentConversationStack + 1);
        let isNewLevel = !currentConversationStack;

        // The stack of responses height
        let currentResponseStack = this.responseStack.get(depth) || 0;
        let increment = conversation.getResponses().size;
        this.responseStack.set(depth, currentResponseStack + increment);

        // position x: depth * (conversation width + spaces)
        // position y: stack * (conversation height + space)+ responses height
        position.left = ConversationEditor.CANVAS_LEFT_TOP_SPACE + depth * (ConversationEditor.CONVERSATION_WIDTH + ConversationEditor.CONVERSATION_SPACE_X);
        position.top = isNewLevel ? ConversationEditor.CANVAS_LEFT_TOP_SPACE : currentConversationStack * (ConversationEditor.CONVERSATION_HEIGHT + ConversationEditor.CONVERSATION_SPACE_Y) + currentResponseStack * ConversationEditor.RESPONSE_HEIGHT;
        return position;
    }

    /**
     * conversation getter - find conversation by ID
     * @param id
     */
    private getConversationById(id: string): Conversation {
        return this.conversations.get(id);
    }

    /**
     * response getter - find response by ID
     * @param id
     */
    private getResponseById(id: string): Response {
        return this.responses.get(id);
    }

    /**
     * Deal with response UI changes
     * @param behavior
     * @param $conversation
     * @param $response
     * @param response
     */
    private responseChangesUI(behavior: string, $conversation: JQuery<HTMLElement>, $response?: JQuery<HTMLElement>, response?: Response) {
        const $listContainer = $conversation.children('.responses_list__js');

        switch (behavior) {
            case 'add':
                ConversationEditor.getResponseTemplate(response).appendTo($listContainer);
                break;
            case 'remove':
                // remove response by conversation & response id
                if ($response && $response.length) {
                    $response.remove();
                }
                break;
            default :
                break;
        }
    }

    /**
     * Deal with response Data changes
     * @param behavior
     * @param conversationID
     * @param responseID
     * @param value
     */
    private responseChangesData(behavior: string, conversationID: string, responseID?: string, value?: string): Response {
        let currentConversation = this.conversations.get(conversationID);
        let currentResponse = responseID ? this.responses.get(responseID) : null;

        switch (behavior) {
            case 'add':
                currentResponse = new Response(currentConversation);
                currentConversation.addResponse(currentResponse);
                this.responses.set(currentResponse.getUuid(), currentResponse);
                break;
            case 'remove':
                // remove response by conversation & response id
                currentConversation.removeResponse(currentResponse);
                this.responses.delete(responseID);
                break;
            case 'update':
                let text = value || '';
                currentResponse.setText(text);
                break;
            default :
                break;
        }

        return currentResponse;
    }

    /**
     * Deal with conversation UI changes
     * @param behavior
     * @param conversationID
     * @param value
     */
    private conversationChangesUI(behavior: string, conversationID: string, value?: string): Conversation {
        let currentConversation = this.conversations.get(conversationID);
        let $conversation = $(`.conversation_template__js[data-id="${conversationID}"]`);
        switch (behavior) {
            case 'add':
                this.drawSingleConversation(currentConversation);
                // reset draggable
                this.setupCanvasUIDraggableBehaviours();
                break;
            case 'remove':
                if ($conversation && $conversation.length) {
                    $conversation.remove();
                }
                break;
            case 'update':
                // ready for update _expressionUrl or any assets
                $conversation.find('.conversation_context').text(value);
                break;
            default :
                break;
        }

        return currentConversation;
    }

    /**
     * Deal with conversation Data changes
     * @param behavior
     * @param conversationID
     * @param value
     * @param cb
     */
    private conversationChangesData(behavior: string, conversationID?: string, value?: string, cb?: any): Conversation {
        let currentConversation;
        if (conversationID) {
            currentConversation = this.conversations.get(conversationID);
        }
        switch (behavior) {
            case 'add':
                // create a conversation without depth, at outside of the groups let's mark it -1
                currentConversation = new Conversation(-1);
                this.conversations.set(currentConversation.getUuid(), currentConversation);
                break;
            case 'remove':
                // affected children update 1:n
                let affectedChildrenResponses = currentConversation.getResponses();
                // check if the children responses have sub conversations
                let hasSubConversations = false;
                affectedChildrenResponses.forEach((response: Response) => {
                    if (response.hasChildren()) {
                        hasSubConversations = true;
                        return false;
                    }
                });
                if (hasSubConversations) {
                    alert("This conversation has sub-conversations, please remove them first.");
                    if (typeof cb === 'function') {
                        // is deleted or not
                        cb(false);
                    }
                    break;
                }
                this.executeConversationRemoval(affectedChildrenResponses, currentConversation);
                if (typeof cb === 'function') {
                    // is deleted or not
                    cb(true);
                }
                break;
            case 'update':
                currentConversation.setContext(value);
                break;
            default :
                break;
        }
        return currentConversation;
    }

    /**
     * Common character setter
     * @param character
     */
    public setCharacter(character: string) {
        // update/refresh all existing characters, if we need single characters edit, this need to be modified
        $('.conversation_template__js:not(".hidden") .character-avatar').each(function () {
            let newUrl = $(this).attr('src').replace(ConversationEditor.character, character);
            $(this).attr('src', newUrl);
        });
        ConversationEditor.character = character;
        this.conversations.forEach((conversation: Conversation) => {
            conversation.updateExpression();
        });
    }

    /**
     * round next expression in the list
     * @param currentExpressionName
     */
    private static getNextExpression(currentExpressionName: string) {
        const currentIndex = EXPRESSION_NAME_DATA.indexOf(currentExpressionName);
        const nextIndex = (currentIndex + 1) % EXPRESSION_NAME_DATA.length;
        return EXPRESSION_NAME_DATA[nextIndex];
    }

    /**
     * Templates generator
     */
    private static getResponseTemplate(response: Response): JQuery<HTMLElement> {
        const newTemplate = ConversationEditor.$responseTemplate.clone();
        newTemplate.attr('data-id', response.getUuid());
        newTemplate.find('.connector').attr('data-id', response.getUuid());
        return newTemplate;
    }

    private static getConversationTemplate(data: any): JQuery<HTMLElement> {
        return ConversationEditor.$conversationTemplate.clone();
    }

    /**
     * A function that allows check is removal success and execute following steps
     *
     * @param conversationId
     * @param isConversationsValid
     */
    private conversationRemovalHandler(conversationId: string, isConversationsValid: boolean) {
        this.conversationChangesData('remove', conversationId, '', (removed: boolean) => {
            if (removed) {
                this.conversationChangesUI('remove', conversationId);
                if (isConversationsValid) {
                    this.tidyConversations();
                }
            }
        });
    }

    /**
     * VALIDATOR/GUARD
     * after check per response has sub conversations, execute conversation removal and update affected stuff
     */
    private executeConversationRemoval(affectedChildrenResponses, currentConversation) {
        this.removeGroupResponses(Array.from(affectedChildrenResponses));
        // affected parent update n:n
        let affectedParentResponses = currentConversation.getParents();
        affectedParentResponses.forEach((response: Response) => {
            response.removeConversation(currentConversation);
        });
        // affected relationship update
        this.updateRelationshipOnRemoval(currentConversation.getUuid());
        this.conversations.delete(currentConversation.getUuid());
    }

    /**
     * Check independent conversations,
     * if some of them aren't belongs to any parent response, show the warning that it will be lost
     */
    private validateConversations(): boolean {
        let negativeConversationIDs = [];
        this.conversations.forEach((conversation: Conversation) => {
            if (conversation.getDepth() >= 0) { // root is 0 , conversations with no relationships are negative
                return true;
            }
            const conversationID = conversation.getUuid();
            negativeConversationIDs.push(conversationID);
            const $conversation = $(`.conversation_templates.conversation_template__js[data-id="${conversationID}"]`);
            $conversation.addClass('error');
        });

        if (negativeConversationIDs.length) {
            this.autoScrollToAConversationCenter(negativeConversationIDs[0]);
            return false;
        }

        return true;
    }

    /**
     * Check independent responses,
     * if some of them don't have any sub conversations, show the warning and mark the error responses
     */
    private validateResponses(): boolean {
        let independentResponses = Array.from(this.responses.values()).filter(response => response.getConversations().size === 0);
        if (independentResponses.length) {
            // show alert
            alert("Please make sure each response connect at least one sub conversation.");
            independentResponses.forEach((response: Response) => {
                const $response = $(`.conversation_templates.response_template__js[data-id="${response.getUuid()}"]`);
                $response.addClass('error');
            });
            // mark red border
            return false;
        }

        return true;
    }

    public static generateRandomColor(): string {
        return `hsl(${Math.floor(360 * Math.random())},${88}%,${50}%)`;
    }

    /**
     * *************************************************************** /
     * [OLD DATA STRUCTURE] The block to handle old config data
     * (convert to new data structure before build or before store)
     * *************************************************************** /
     */

    /**
     * [OLD DATA STRUCTURE]
     * The block to handle old config json data 'questions'
     */
    private oldQuestionDataHandler(questions: any) {
        if (!questions || !questions.length) {
            return;
        }
        // create conversations - responses from config data 'question'
        questions.forEach((question) => {
            let conversation: Conversation = new Conversation();
            // root is always existing conversation
            if (question.position[0] == 0 && question.position[1] == 0 && !this.rootConversation) {
                this.rootConversation = conversation;
            }
            question['id'] = conversation.getUuid();
            conversation.setContext(question['text']);
            question['answers'].forEach((answer) => {
                let response = new Response(conversation, answer['text']);
                conversation.addResponse(response);
                this.responses.set(response.getUuid(), response);
                answer['id'] = response.getUuid();
            });
            this.conversations.set(conversation.getUuid(), conversation);
        });
    }

    /**
     * [OLD DATA STRUCTURE]
     * convert old revision data's relationship to the current version
     * answer -> response ; question -> conversation
     */
    private buildRelationshipsFromOldData(questions: any) {
        // cause original scatterChart rate(x:y) is not 1:1
        const xyAxeRate = 2; // original char x:y  = 2:1

        // answer = response; subQuestion = conversation
        questions.forEach((questionObj) => {
            questionObj['answers'].forEach((answer) => {
                let subQuestions = questions.filter((question) => {
                    let cloneQuestion = [...question.position];
                    let cloneAnswer = [...answer.move];
                    let questionPos: [number, number] = [cloneQuestion[0] * xyAxeRate, cloneQuestion[1]];
                    let answerPos: [number, number] = [cloneAnswer[0] * xyAxeRate, cloneAnswer[1]];
                    return ConversationEditor.distance(answerPos, questionPos) <= ConversationEditor.CIRCLE_RADIUS;
                });

                subQuestions.forEach((relatedQuestion) => {
                    let conversationID = relatedQuestion['id'];
                    let responseID = answer['id'];
                    this.addSvgConnectorLinesData(conversationID, responseID);
                });
            });
        });
    }

    /**
     * [OLD DATA STRUCTURE]
     * compile the current new structure data to the old
     */
    public compileToOldRevisionData() {
        let questions = [];
        let answerMovementsMap = new Map<string, [number, number]>();
        this.conversations.forEach((conversation: Conversation) => {
            let question = {};
            question['text'] = conversation.getContext();
            question['id'] = conversation.getUuid();
            let answers = [];
            conversation.getResponses().forEach((response: Response) => {
                let answer = {};
                answer['text'] = response.getText();
                let movement = ConversationEditor.calculateAnswerMovement();
                answer['move'] = movement;
                answerMovementsMap.set(response.getUuid(), movement);
                answers.push(answer);
            });
            question['answers'] = answers;
            questions.push(question);
        });

        // need to get all questions(conversations) before find relationships
        questions.forEach((question) => {
            let conversation = this.conversations.get(question['id']);
            let answerCircles = [];
            conversation.getParents().forEach((response: Response) => {
                let answerMove = answerMovementsMap.get(response.getUuid());
                answerCircles.push(answerMove);
            });
            let questionPos = ConversationEditor.calculateQuestionPosition(answerCircles);
            question['position'] = questionPos;
        });
        return questions;
    }

    /**
     * [OLD DATA STRUCTURE]
     * calculate the position for old structure converter
     */
    private static calculateQuestionPosition(answerCircles: any): [number, number] {
        let position: [number, number] = [0, 0];
        if (!answerCircles || !answerCircles.length) {
            return position;
        }

        if (answerCircles.length === 1) {
            return answerCircles[0];
        } else {
            return answerCircles.pop();
        }
    }

    /**
     * [OLD DATA STRUCTURE]
     * calculate the position for old structure converter
     * TODO: the response(answer) doesn't have positions judgement in new version editor(use weight/points ?)
     */
    private static calculateAnswerMovement(): [number, number] {
        let move: [number, number] = [0, 0];
        let randomXInCircle = this.roundTo(this.getRandomArbitrary(-this.CIRCLE_RADIUS, this.CIRCLE_RADIUS), 3);
        let randomYInCircle = this.roundTo(Math.sqrt(Math.pow(this.CIRCLE_RADIUS, 2) - Math.pow(randomXInCircle, 2)), 3);
        move[0] = randomXInCircle;
        move[1] = randomYInCircle;
        return move;
    }

    /**
     * [OLD DATA STRUCTURE]
     */
    private static distance(p1: Point, p2: Point): number {
        const a = _.zipWith(p1, p2, _.subtract).map(x => Math.pow(x, 2));
        return Math.sqrt(a[0] + a[1]);
    }

    /**
     * Get a random x y within (x or y: -0.3 to 0.3)
     * @param min
     * @param max
     */
    private static getRandomArbitrary(min, max) {
        return Math.random() * (max - min) + min;
    }

    /**
     * round a decimal to specific decimal
     * @param value
     * @param decimal
     */
    private static roundTo(value, decimal) {
        return Math.floor(value * Math.pow(10, decimal)) / Math.pow(10, decimal);
    }

    /**
     * **************************************************************** /
     * [OLD DATA STRUCTURE] End of block to handle old config data
     * **************************************************************** /
     */
}

export class Conversation {
    private _uuid: string;
    private _depth: number;
    private _context: string;
    private _type = 'conversation';
    private _parents: Set<Response>;
    private _responses: Set<Response>;
    private _expressionUrl: string;
    private _expressionName: string;

    constructor(depth?: number, parentArr?: Set<Response>, responses?: Set<Response>) {
        this._uuid = uuid.v4();
        this._context = '';
        this._depth = depth || 0;
        this._parents = parentArr || new Set<Response>();
        this._responses = responses || new Set<Response>();
        this._expressionName = EXPRESSION_NAME_DATA[0];
        this._expressionUrl = `${ConversationEditor.IMAGE_ASSETS_PATH}${ConversationEditor.character}/${this._expressionName}.${ConversationEditor.IMAGE_ASSETS_TYPE}`;
    }

    public setAssets(expressionName: string, _expressionUrl: string, context?: string) {
        this._context = context || '';
        this._expressionName = expressionName || EXPRESSION_NAME_DATA[0];
        this._expressionUrl = `${ConversationEditor.IMAGE_ASSETS_PATH}${ConversationEditor.character}/${this._expressionName}.${ConversationEditor.IMAGE_ASSETS_TYPE}`;
    }

    public getUuid(): string {
        return this._uuid;
    }

    public setUuid(value: string) {
        this._uuid = value;
    }

    public getExpressionName(): string {
        return this._expressionName;
    }

    public setExpressionName(value: string) {
        this._expressionName = value;
        return this;
    }

    public getExpressionUrl(): string {
        return this._expressionUrl;
    }

    public setExpressionUrl(value: string) {
        this._expressionUrl = value;
        return this;
    }

    public updateExpression() {
        this._expressionUrl = `${ConversationEditor.IMAGE_ASSETS_PATH}${ConversationEditor.character}/${this._expressionName}.${ConversationEditor.IMAGE_ASSETS_TYPE}`;
    }

    public getContext(): string {
        return this._context;
    }

    public setContext(value: string) {
        this._context = value;
    }

    public getDepth(): number {
        return this._depth;
    }

    public setDepth(depth: number) {
        this._depth = depth;
    }

    public getParents(): Set<Response> {
        return this._parents;
    }

    public getParentsJSON(): any {
        let parentsJSON = [];
        this._parents.forEach((response: Response) => {
            parentsJSON.push(response.toJSON());
        });
        return parentsJSON;
    }

    public setParents(responseArr: Set<Response>) {
        this._parents = responseArr;
    }

    public addParentResponse(response: Response) {
        if (!this._parents.has(response)) {
            this._parents.add(response);
        }
        return this;
    }

    public removeParentResponse(response: Response) {
        this._parents.delete(response);
    }

    public getResponses(): Set<Response> {
        return this._responses;
    }

    public getResponsesJSON(): any {
        let responsesJSON = [];
        this._responses.forEach((response: Response) => {
            responsesJSON.push(response.toJSON());
        });
        return responsesJSON;
    }

    public parseResponses(): any {
        let parsedJSON = [];
        this._responses.forEach((response: Response) => {
            parsedJSON.push(response.deepParse());
        });
        return parsedJSON;
    }

    public hasChildren(): boolean {
        return this._responses.size > 0;
    }

    public hasParents(): boolean {
        return this._parents.size > 0;
    }

    public hasMultiParents(): boolean {
        return this._parents.size > 1;
    }

    public setResponses(array: Set<Response>) {
        this._responses = array;
    }

    public addResponse(response: Response) {
        if (!this._responses.has(response)) {
            this._responses.add(response);
        }
        return this;
    }

    public removeResponse(response: Response) {
        this._responses.delete(response);
    }

    public isMaxResponsesReached(): boolean {
        return this._responses.size >= ConversationEditor.MAX_RESPONSES_COUNT;
    }

    public toJSON(): any {
        return {
            id: this._uuid,
            type: this._type,
            depth: this._depth,
            context: this._context,
            expression_url: this._expressionUrl,
            expression_name: this._expressionName,
            hasParents: this.hasParents(),
            hasChildren: this.hasChildren(),
            responses: this.getResponsesJSON(),
            parents: this.getParentsJSON(),
        }
    }

    /**
     * deep parse that goes to the deepest conversation until end
     */
    public deepParse(): any {
        return {
            id: this._uuid,
            type: this._type,
            depth: this._depth,
            context: this._context,
            expression_url: this._expressionUrl,
            expression_name: this._expressionName,
            hasChildren: this.hasChildren(),
            response_children: this.parseResponses(),
        }
    }
}

export class Response {
    private _uuid: string;
    private _type = 'response';
    private _text: string;
    private _parent: Conversation;
    private _children: Set<Conversation>;

    constructor(parent: Conversation, responseText?: string, children?: Set<Conversation>) {
        this._uuid = uuid.v4();
        this._parent = parent;  // 1:1
        this._text = responseText || '';
        this._children = children || new Set<Conversation>(); // n:n
    }

    public getUuid(): string {
        return this._uuid;
    }

    public setUuid(value: string) {
        this._uuid = value;
    }

    public getParent(): Conversation {
        return this._parent;
    }

    public setParent(value: Conversation) {
        this._parent = value;
    }

    public getText(): string {
        return this._text;
    }

    public setText(value: string) {
        this._text = value;
    }

    public hasChildren(): boolean {
        return this._children.size > 0;
    }

    public hasMultiChildren(): boolean {
        return this._children.size > 1;
    }

    public parseChildren(): any {
        let parsedJSON = [];
        this._children.forEach((conversation: Conversation) => {
            parsedJSON.push(conversation.deepParse());
        });
        return parsedJSON;
    }

    public getChildrenIDs(): any {
        return Array.from(this._children.values()).map(conversation => conversation.getUuid());
    }

    public getConversations(): Set<Conversation> {
        return this._children;
    }

    public setConversations(value: Set<Conversation>) {
        this._children = value;
    }

    public addConversation(conversation: Conversation) {
        if (!this._children.has(conversation)) {
            this._children.add(conversation);
        }
        return this;
    }

    public removeConversation(conversation: Conversation) {
        this._children.delete(conversation);
    }

    public toJSON(): any {
        return {
            id: this._uuid,
            text: this._text,
            type: this._type,
            parent_id: this._parent.getUuid(),
            children_ids: this.getChildrenIDs(),
        }
    }

    /**
     * deep parse that goes to the deepest data structure until end
     */
    public deepParse(): any {
        return {
            id: this._uuid,
            type: this._type,
            text: this._text,
            hasChildren: this.hasChildren(),
            conversation_children: this.parseChildren(),
        }
    }
}

export class RelationshipLine {
    private _id: string;
    // before/after are the boxes' positions
    private _before: Conversation;
    private _after: Response;
    private _weight: number;
    private _points: number;
    private readonly _color: string;

    constructor(id: string, before: Conversation, after: Response, weight?: number, points?: number) {
        this._id = id;
        this._weight = weight || 0;
        this._points = points || 0;
        this._before = before;
        this._after = after;
        this._color = ConversationEditor.generateRandomColor();
    }

    getId(): string {
        return this._id;
    }

    setId(value: string) {
        this._id = value;
    }

    getSettingId() {
        return this._id.replace('comb', '');
    }

    getBefore(): Conversation {
        return this._before;
    }

    setBefore(value: Conversation) {
        this._before = value;
    }

    getAfter(): Response {
        return this._after;
    }

    setAfter(value: Response) {
        this._after = value;
    }

    getWeight(): number {
        return this._weight;
    }

    setWeight(value: number) {
        this._weight = value;
    }

    getPoints(): number {
        return this._points;
    }

    setPoints(value: number) {
        this._points = value;
    }

    getColor(): string {
        return this._color;
    }

    toJSON(): any {
        return {
            id: this._id,
            weight: this._weight,
            points: this._points,
            conversation_id: this._before.getUuid(),
            response_id: this._after.getUuid()
        }
    }
}