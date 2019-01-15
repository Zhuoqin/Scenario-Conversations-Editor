declare let window: any;
declare let $: any;

export class EditorClass {
    private $container;
    private static $cloneResponse;
    private $listContainer;

    constructor(container?: JQuery<HTMLElement>) {
        this.$container = container;
        EditorClass.$cloneResponse = container.find('.conversation_templates.response_template__js').eq(0);
        this.$listContainer = container.find('.responses_list__js');
        this.setupEvents();
    }

    private setupEvents(): void {
        this.$container.on('click', '.add-response-btn', (e) => {
            e.preventDefault();
            EditorClass.$cloneResponse.clone().removeClass('hidden').appendTo(this.$listContainer);
        });

        this.$container.on('click', '.conversation_template__js .trash-response-btn', function (e) {
            e.preventDefault();
            $(e.target).closest('.response_template__js').remove();
        });
    }
}