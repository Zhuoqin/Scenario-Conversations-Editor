import * as d3 from "d3";
import nunjucks = require('nunjucks');
import uuid = require("uuid");

declare let window: any;
declare let $: any;

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

    // draw conversations
    private rootConversation: Conversation;
    private conversations: Map<string, Conversation>;  // conversations group Map<id, Conversation>
    private drawConversations: Set<string>;  // conversations already draw Map<id>
    private responses: Map<string, Response>;   // responses group Map<id, Response>
    private conversationStack: Map<number, number>; // stack for each level of conversations :Map<depth, stack>
    private responseStack: Map<number, number>; // stack for each level of responses :Map<depth, stack>
    private connectorLines: Map<string, RelationshipLine>; // line that has Map<id, Relationship>
    private lineGroup: any;
    private iterationMaxDepth: number;
    private static CIRCLE_RADIUS = 0.3;
    private static CONVERSATION_WIDTH = 300;
    private static CONVERSATION_HEIGHT = 230;
    private static RESPONSE_HEIGHT = 165;
    private static CONVERSATION_SPACE_X = 250;
    private static CONVERSATION_SPACE_Y = 150;

    // line config
    private $relationship_config: JQuery<HTMLElement>;
    private editingRelationship: RelationshipLine;
    private dThreeLineFunction = d3.line()
        .curve(d3.curveCardinal);

    // guide
    private $guideTipsBlock: JQuery<HTMLElement>;
    private $guideTipsText: JQuery<HTMLElement>;
    private GUIDE_STEPS = [
        'Configure the conversation’s starting point!',
        'Add responses, and outcomes to those responses.',
        'Nice, you’ve added an outcome!  You can hover over the connector for more options.',
        'Weight influences the likelihood that this outcome is used in a multiple outcome situation.  Points can be negative.',
        'Press "Ctrl" & scroll mouse to control, double click to zoom in.'
    ];

    // zoom
    private zoomed: boolean;
    private $canvasMask: JQuery<HTMLElement>;

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
        this.$relationship_config = $('.relationship_config_window').eq(0);
        this.$finishBtn = $('#conversation_drawer_finish');
        // zoom part
        this.$canvasMask = $('#canvas-mask');
        this.zoomed = false;
        $('#zoom-container').tooltip();

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
            const $target = $(e.target);
            const $currentResponse = $target.closest('.response_template__js');
            const $currentConversation = $target.closest('.conversation_template__js');
            // Data related to elements' IDs
            let newCreatedResponse = this.responseChangesData('add', $currentConversation.data('id'));
            // UI related to elements
            this.responseChangesUI('add', $currentConversation, $currentResponse, newCreatedResponse);
            this.showGuideText(1);
        });

        this.$container.on('click', '.trash-response-btn', (e) => {
            e.preventDefault();
            const $target = $(e.target);
            const $currentResponse = $target.closest('.response_template__js');
            const $currentConversation = $target.closest('.conversation_template__js');
            let currentResponse = this.responses.get($currentResponse.data('id'));
            if (currentResponse.hasChildren()) {
                alert("This response has sub-conversations, you need to remove them before deleting.");
                return;
            }
            // UI related to elements
            this.responseChangesUI('remove', $currentConversation, $currentResponse);
            // Data related to elements' IDs
            this.responseChangesData('remove', $currentConversation.data('id'), $currentResponse.data('id'));
            // affect related lines data
            this.updateRelationshipOnRemoval($currentResponse.data('id'));
            // trigger canvas adjust
            $('.tidy-conversation-btn').trigger('click');
        });

        this.$container.on('click', '.add-outcome-btn', (e) => {
            e.preventDefault();
            const $target = $(e.target);
            const $currentResponse = $target.closest('.response_template__js');
            let newCreatedConversation = this.conversationChangesData('add');
            this.conversationChangesUI('add', newCreatedConversation.getUuid());
            this.addSvgConnectorLinesData(newCreatedConversation.getUuid(), $currentResponse.data('id'));
            this.drawSvgConnectorLinesUI();
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

        this.$container.on('keydown', '.response-text textarea', (e) => {
            const $target = $(e.target);

            if (e.keyCode === 13) {
                e.preventDefault();
                // enter key press auto make it skip to next response text field
                let $nextResponse = $target.closest('.response_template__js').next();
                if ($nextResponse && $nextResponse.length) {
                    let value = $nextResponse.find('textarea').val();
                    $nextResponse.find('textarea').val('').val(value).focus();
                }
            }
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
                const boxBefore = $('.connector.active.before');
                const boxAfter = $('.connector.active.after');
                this.addSvgConnectorLinesData(boxBefore.data('id'), boxAfter.data('id'));
                this.drawSvgConnectorLinesUI();
                this.showGuideText(2);
                // remove active box after connected
                $('.connector').removeClass('active');
                // remove error if error class
                boxBefore.closest('.conversation_template__js').removeClass('error');
                boxAfter.closest('.response_template__js').removeClass('error');
            }
        });

        // canvas
        this.$canvas.on('click', '.svg_container .line', (e) => {
            const $target = $(e.target);
            this.$relationship_config.css({
                'z-index': 1,
                'top': e.offsetY,
                'left': e.offsetX,
            });
            this.$svgContainer.find('path').removeClass('active');
            $target.addClass('active');
            let id = $target.attr('id');
            this.editingRelationship = this.connectorLines.get(id);
            this.renderRelationshipConfig();
            this.$relationship_config.fadeIn();
            // $('#relationship_config_form').validate();
            this.showGuideText(3);
        });

        this.$canvas.on('click', '.conversation_context_container .conversation_context', (e) => {
            $(e.target).velocity('hide', () => {
                $(e.target).siblings('.conversation_context_input').velocity('show', function () {
                    $(this).focus();
                }, 'fast');
            }, 'fast');
        });

        this.$canvas.on('input', '.conversation_context_container .conversation_context_input', (e) => {
            let id = $(e.target).closest('.conversation_template__js').data('id');
            let text = $(e.target).val().toString().trim();
            this.conversationChangesUI('update', id, text);
            this.conversationChangesData('update', id, text);
        });

        this.$canvas.on('keypress', '.conversation_context_container .conversation_context_input', (event) => {
            if (event.which === 13) {
                $(event.target).velocity('hide', () => {
                    $(event.target).siblings('.conversation_context').velocity('show', 'fast');
                }, 'fast');
            }
        });

        this.$canvas.on('click', '.trash-conversation-btn', (e) => {
            let conversationId = $(e.target).closest('.conversation_template__js').data('id');
            let r = confirm("Are you sure to remove this conversation?");
            if (r == true) {
                this.conversationChangesData('remove', conversationId, '', (removed: boolean) => {
                    if (removed) {
                        this.conversationChangesUI('remove', conversationId);
                        // trigger canvas adjust
                        $('.tidy-conversation-btn').trigger('click');
                    }
                });
            }
        });

        this.$canvas.on('click', (e) => {
            const $target = $(e.target);
            // close editing textarea
            if (!$target.is('textarea.conversation_context_input')) {
                $("textarea.conversation_context_input:visible").each((index, el) => {
                    $(el).velocity('hide', () => {
                        $(el).siblings('.conversation_context').velocity('show', 'fast');
                    }, 'fast');
                });
            }

            // unselect path
            if (!$target.is('path')) {
                this.triggerRelationshipConfigForm();
            }
        });

        // modal
        this.$modalContainer.on('click', '.add-conversation-point-btn', (e) => {
            e.preventDefault();
            // prevent ui change when the scale is not normal
            if (this.zoomed) {
                $('#zoom-reset').trigger('click');
            }
            if (this.hasIndependentConversations()) {
                return;
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
            if (this.hasIndependentConversations()) {
                return;
            }
            // close relationship config
            this.triggerRelationshipConfigForm();
            // reset stacks
            this.iterationMaxDepth = 0;
            this.drawConversations = new Set<string>();
            this.conversationStack = new Map<number, number>();
            this.responseStack = new Map<number, number>();
            this.$svgContainer.siblings().not(this.$canvasMask).remove();
            this.recursiveDrawConversations(this.rootConversation);
            this.redrawSvgConnectorLines();
            this.adjustCanvasSize();
            this.setupCanvasUIDraggableBehaviours();
        });

        // behaviors
        this.$behaviorsBlock.on('click', '#zoom-reset', (e) => {
            e.preventDefault();
            this.resetZoomView();
            // reset guide text
            this.showGuideText();
        });

        // relationship popup
        this.$relationship_config.on('submit', 'form', (e) => {
            e.preventDefault();
            let newWeight = Number(this.$relationship_config.find('input[name="weight"]').val());
            let newPoints = Number(this.$relationship_config.find('input[name="points"]').val());
            this.editingRelationship.setWeight(newWeight);
            this.editingRelationship.setPoints(newPoints);
            this.connectorLines.set(this.editingRelationship.getId(), this.editingRelationship);
            this.editingRelationship = null;
            this.$relationship_config.css({
                'z-index': -1,
                'display': 'none'
            });
            this.$svgContainer.find('.line.active').removeClass('active');
        });

        this.$relationship_config.on('click', '#relationship_config_delete', (e) => {
            e.preventDefault();
            if (this.$relationship_config.is(':visible') && this.editingRelationship) {
                this.checkAndRemoveRelationship();
            }
        });

        this.$finishBtn.on('click', () => {
            if (this.hasIndependentConversations()) {
                return;
            }
            if (this.hasIndependentResponses()) {
                return;
            }
            this.triggerRelationshipConfigForm();
            this.$modalContainer.modal('hide');
            this.compileRevisionData();
        });

        // outer modal triggers
        $('#scenario_draw_modal_btn').on('click', () => {
            this.$modalContainer.modal('show');
        });
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
        this.$behaviorsBlock.find('#zoom-percentage').text('100');
        // hide canvas mask
        this.$canvasMask.addClass('hidden');
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
        if (!this.config) {
            return;
        }
        let {scenarioData} = this.config;
        let {questions} = this.config;
        // if created new, auto build an empty root conversation for it
        if (!scenarioData && !questions) {
            this.rootConversation = new Conversation();
            this.conversations.set(this.rootConversation.getUuid(), this.rootConversation);
            return;
        }

        let {relationships} = scenarioData;
        if (!relationships) {
            return;
        }

        let {conversations} = scenarioData;
        let {responses} = scenarioData;
        this.iterativeBuildConversations(conversations, responses);
        this.buildRelationships(relationships);
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
        conversation.setAssets(conversationObj['context'], conversationObj['expression_name'], conversationObj['expression_url']);
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
            conversation.setAssets(conversationObj['context'], conversationObj['expression_name'], conversationObj['expression_url']);
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
            this.editingRelationship = null;
            this.$relationship_config.css({
                'z-index': -1,
                'display': 'none'
            });
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
    private drawSvgConnectorLinesUI() {
        let lines = this.lineGroup.selectAll("path").data(Array.from(this.connectorLines.values())).enter().append('path');
        this.assignLinesAttributes(lines);
    }

    /**
     * redraw eisting lines on drag
     */
    private redrawSvgConnectorLines() {
        let lines = this.lineGroup.selectAll("path").data(Array.from(this.connectorLines.values()));

        lines.exit().remove();
        lines.enter().append("path");
        this.assignLinesAttributes(lines);
    }

    /**
     * shared method to set line's attributes - id, weight, points
     * @param lines
     */
    private assignLinesAttributes(lines: any) {
        lines.attr("class", "line")
            .attr("stroke-width", 2)
            .attr("stroke", "black")
            .attr("d", (data, index, line) => {
                let lineData = this.fetchSingleLineData(data);
                if (lineData && lineData.length) {
                    return this.dThreeLineFunction(ConversationEditor.compileCurveLineData(lineData));
                }
            })
            .attr("id", (data, index, line) => {
                return data.getId();
            });
    }

    /**
     * Fetch single relationship line data
     */
    private fetchSingleLineData(relationship: RelationshipLine): [number, number][] {
        let afterID = relationship.getAfter().getUuid();
        let beforeID = relationship.getBefore().getUuid();
        const boxBefore = $(`.connector.before[data-id="${beforeID}"]`);
        const boxAfter = $(`.connector.after[data-id=${afterID}]`);
        return ConversationEditor.calculateConnectorLineData(boxBefore, boxAfter);
    }

    /**
     * line data generator that separate one line to three, e.g [[x1,y1],[x2,y2]] to [[x1,y1],[x2,y2],[x3,y3],[x3,y3],[x4,y4]];
     * @param lineData
     */
    private static compileCurveLineData(lineData: [number, number][]): [number, number][] {
        let posStart: [number, number] = lineData[0];
        let posEnd: [number, number] = lineData[1];

        const width = Math.abs(posStart[0] - posEnd[0]);  // abs(x1 - x2)
        const height = Math.abs(posStart[1] - posEnd[1]); // abs(y1 - y2)
        const xIncrement = width / 4;
        const yIncrement = height / 8;
        const maxX = Math.max(posStart[0], posEnd[0]);
        const maxY = Math.max(posStart[1], posEnd[1]);
        const minX = Math.min(posStart[0], posEnd[0]);
        const minY = Math.min(posStart[1], posEnd[1]);

        let isFirstZone = posStart[0] < posEnd[0] && posStart[1] > posEnd[1];
        let isSecondZone = posStart[0] > posEnd[0] && posStart[1] > posEnd[1];
        let isThirdZone = posStart[0] > posEnd[0] && posStart[1] < posEnd[1];
        let isFourthZone = posStart[0] < posEnd[0] && posStart[1] < posEnd[1];
        let subPos_1: [number, number];
        let subPos_2: [number, number];
        if (isFirstZone) {
            subPos_1 = [minX + xIncrement, maxY - yIncrement];
            subPos_2 = [maxX - xIncrement, minY + yIncrement];
        } else if (isSecondZone) {
            subPos_1 = [maxX - xIncrement, maxY - yIncrement];
            subPos_2 = [minX + xIncrement, minY + yIncrement];
        } else if (isThirdZone) {
            subPos_1 = [maxX - xIncrement, minY + yIncrement];
            subPos_2 = [minX + xIncrement, maxY - yIncrement];
        } else if (isFourthZone) {
            subPos_1 = [minX + xIncrement, minY + yIncrement];
            subPos_2 = [maxX - xIncrement, maxY - yIncrement];
        } else {
            return [posStart, posEnd];
        }

        return [posStart, subPos_1, subPos_2, posEnd];
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
        this.redrawSvgConnectorLines();
    }

    /**
     * returns calculated position [[x1, y1]&[x2, y2]]
     * @param boxBefore
     * @param boxAfter
     */
    private static calculateConnectorLineData(boxBefore: JQuery<HTMLElement>, boxAfter: JQuery<HTMLElement>): [number, number][] {
        if (!boxBefore.length || !boxAfter.length) {
            return [];
        }

        let conversationAfterPos = boxAfter.closest('.conversation_template__js').position();

        let wrapperBeforePos = boxBefore.parent().position();
        let wrapperAfterPos = boxAfter.parent().position();

        let beforePos = boxBefore.position();
        let afterPos = boxAfter.position();

        let startX = conversationAfterPos.left + wrapperAfterPos.left + afterPos.left + 20;
        let startY = conversationAfterPos.top + wrapperAfterPos.top + afterPos.top + 20;
        let endX = wrapperBeforePos.left + beforePos.left;
        let endY = wrapperBeforePos.top + beforePos.top + 10;

        return [[startX, startY], [endX, endY]];
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
     * @param step
     * @param type
     */
    private showGuideText(step: number = 0, type: string = 'info'): void {
        let text = this.GUIDE_STEPS[step] || '';
        let color = '#0fe67a'; // default guide color

        switch (type) {
            case 'info':
                color = '#0fe67a';
                break;
            case 'warn':
                color = '#d9edf7';
                break;
            case 'alert':
                color = '#f2dede';
                break;
        }

        this.$guideTipsBlock.css('background-color', color);
        this.$guideTipsText.text(text);
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
            .on('drag', function () {
                let sourceEvent = d3.event.sourceEvent;
                // adjust canvas if exceed
                let extendWidth = $(this).position().left + ConversationEditor.CONVERSATION_WIDTH;
                let extendHeight = $(this).position().top + ConversationEditor.CONVERSATION_HEIGHT;
                if (extendWidth > canvasWidth) {
                    self.$canvas.width(Math.max(canvasWidth, extendWidth));
                }
                if (extendHeight > canvasHeight) {
                    self.$canvas.height(Math.max(canvasWidth, extendHeight));
                }
                currentX = sourceEvent.clientX - initialX;
                currentY = sourceEvent.clientY - initialY;
                $(this).css({left: position.left + currentX, top: position.top + currentY});
                self.redrawSvgConnectorLines();
            })
            .on('end', function () {
                dragging = false;
                initialX = currentX = 0;
                initialY = currentY = 0;
                position = null;
                self.$svgContainer.css('z-index', '0');
                $(this).css('z-index', '1');
            })
            .on('start', function () {
                dragging = true;
                let sourceEvent = d3.event.sourceEvent;
                // record current position
                position = $(this).position();
                initialX = sourceEvent.clientX;
                initialY = sourceEvent.clientY;
                self.$svgContainer.css('z-index', '2');
                $(this).css('z-index', '10');
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
        this.$behaviorsBlock.find('#zoom-percentage').text(Math.floor(scale * 100));
        if (scale === 1) {
            this.showGuideText();
        } else {
            this.showGuideText(4);
        }
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
        this.responses = new Map<string, Response>();
        this.conversationStack = new Map<number, number>();
        this.responseStack = new Map<number, number>();
        this.connectorLines = new Map<string, RelationshipLine>();
        this.lineGroup = this.svgContainer.append("g").attr("class", "lineGroup");

        this.sanitizeConfigurationData();
        this.recursiveDrawConversations(this.rootConversation);
        this.adjustCanvasSize();
        this.drawSvgConnectorLinesUI();
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
        const conversationStacks = Math.max(...Array.from(this.conversationStack.values())) + 1;
        const responseStacks = Math.max(...Array.from(this.responseStack.values())) + 1;
        let maxX = (this.conversationStack.size + 1) * (ConversationEditor.CONVERSATION_WIDTH + ConversationEditor.CONVERSATION_SPACE_X);
        let maxY = conversationStacks * ConversationEditor.CONVERSATION_HEIGHT
            + responseStacks * ConversationEditor.RESPONSE_HEIGHT + conversationStacks * ConversationEditor.CONVERSATION_SPACE_Y;
        let radius = Math.max(maxX, maxY);
        // mini size 1024x1024
        this.$canvas.height(`${radius}px`);
        this.$canvas.width(`${radius}px`);
    }

    /**
     * This method is used to draw a single conversation by passing conversation object in
     * it will automatically calculate the position depends on its depth and responses stacks
     * @param conversation
     */
    private drawSingleConversation(conversation: Conversation) {
        let position = this.calculateConversationPosition(conversation);
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
            const addPointsBtnPosition = $('.add-conversation-point-btn').offset();
            return {
                left: addPointsBtnPosition.left + this.$canvas.parent().prop('scrollLeft'),
                top: addPointsBtnPosition.top - ConversationEditor.CONVERSATION_HEIGHT - 40 + this.$canvas.parent().prop('scrollTop')
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

        // position x: depth * (conversation width + space)
        // position y: stack * (conversation height + space)+ responses height
        position.left = depth * (ConversationEditor.CONVERSATION_WIDTH + ConversationEditor.CONVERSATION_SPACE_X);
        position.top = isNewLevel ? 0 : currentConversationStack * (ConversationEditor.CONVERSATION_HEIGHT + ConversationEditor.CONVERSATION_SPACE_Y) + currentResponseStack * ConversationEditor.RESPONSE_HEIGHT;
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
        ConversationEditor.character = character;
        // update/refresh all existing characters, if we need single characters edit, this need to be modified
        $('.character-avatar').attr({'src': `/assets/scenario/images/characters/${character}/start.png`, 'alt': character});
        this.conversations.forEach((conversation: Conversation) => {
            conversation.setExpressionName(character).setExpressionUrl(character);
        });
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
    private hasIndependentConversations(): boolean {
        if (!this.conversations.size) {
            return false;
        }
        let independentConversation = Array.from(this.conversations.values()).find(conversation => conversation.getDepth() === -1);
        if (independentConversation) {
            // show alert
            alert("To continue, please make sure each conversation belongs to at least one response block.");
            // mark red border
            if (typeof independentConversation === 'object') {
                const $conversation = $(`.conversation_templates.conversation_template__js[data-id="${independentConversation.getUuid()}"]`);
                $conversation.addClass('error');
                let scrollToPosition = ConversationEditor.calculateScrollPosition($conversation);
                this.$canvas.parent().get(0).scrollTo(scrollToPosition[0], scrollToPosition[1]);
            }
            return true;
        }

        return false;
    }

    /**
     * Check independent responses,
     * if some of them don't have any sub conversations, show the warning and mark the error responses
     */
    private hasIndependentResponses(): boolean {
        if (!this.responses.size) {
            return false;
        }
        let independentResponses = Array.from(this.responses.values()).filter(response => response.getConversations().size === 0);
        console.log(independentResponses);
        if (independentResponses.length) {
            // show alert
            alert("Please make sure each response connect at least one sub conversation.");
            independentResponses.forEach((response: Response) => {
                const $response = $(`.conversation_templates.response_template__js[data-id="${response.getUuid()}"]`);
                $response.addClass('error');
            });
            // mark red border
            return true;
        }

        return false;
    }
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
        this._expressionUrl = ConversationEditor.character;  // note: this is able to be configurable
        this._expressionName = ConversationEditor.character; // note: this is able to be configurable
        this._context = '';
        this._depth = depth || 0;
        this._parents = parentArr || new Set<Response>();
        this._responses = responses || new Set<Response>();
    }

    public setAssets(context?: string, _expressionUrl?: string, expressionName?: string) {
        this._context = context || '';
        this._expressionName = expressionName || ConversationEditor.character;
        this._expressionUrl = _expressionUrl || '';
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

    constructor(id: string, before: Conversation, after: Response, weight?: number, points?: number) {
        this._id = id;
        this._weight = weight || 0;
        this._points = points || 0;
        this._before = before;
        this._after = after;
    }

    getId(): string {
        return this._id;
    }

    setId(value: string) {
        this._id = value;
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